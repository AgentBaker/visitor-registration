const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();

app.use(cors());
app.use(express.json());

// ✅ HEALTH CHECK FIRST (must respond instantly)
app.get('/ping', (req, res) => {
  return res.status(200).json({ ok: true });
});

// multer
const upload = multer({
  dest: path.join(__dirname, 'tmp'),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// 🔥 REMOVE global supabase ❌
// const supabase = createClient(...)

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

// POST
app.post('/save-visit', upload.array('files'), async (req, res) => {
  try {
    const supabase = getSupabase(); // ✅ lazy init

    const { host, department, purpose, company, date, time, visitors } = req.body;
    const parsedVisitors = JSON.parse(visitors);

    const { data: session, error: sessionError } = await supabase
      .from('visit_sessions')
      .insert([{
        host_employee: host,
        department,
        purpose,
        company,
        entry_date: date,
        entry_time: time
      }])
      .select()
      .single();

    if (sessionError) throw sessionError;

    const results = [];

    for (let i = 0; i < parsedVisitors.length; i++) {
      let fileUrl = null;

      if (req.files[i]) {
        const file = req.files[i];
        const stream = fs.createReadStream(file.path);

        const filePath = `ids/session_${session.id}_${Date.now()}_${file.originalname}`;

        const { data, error } = await supabase.storage
          .from(process.env.BUCKET_NAME)
          .upload(filePath, stream);

        fs.unlink(file.path, () => { });
        if (error) throw error;

        const { data: publicData } = supabase.storage
          .from(process.env.BUCKET_NAME)
          .getPublicUrl(data.path);

        fileUrl = publicData.publicUrl;
      }

      results.push({
        session_id: session.id,
        fullname: parsedVisitors[i].fullname,
        contact_number: parsedVisitors[i].contact_number,
        id_number: parsedVisitors[i].id_number,
        id_attachment_url: fileUrl
      });
    }

    const { error: visitorsError } = await supabase
      .from('visitors')
      .insert(results);

    if (visitorsError) throw visitorsError;

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET
app.get('/sessions', async (req, res) => {
  try {
    const supabase = getSupabase(); // ✅ lazy init

    const { data, error } = await supabase
      .from('visit_sessions')
      .select(`
        id,
        host_employee,
        department,
        entry_date,
        entry_time,
        visitors (
          id,
          fullname,
          contact_number,
          id_number,
          id_attachment_url
        )
      `)
      .order('entry_date', { ascending: false });

    if (error) throw error;

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// start
const PORT = process.env.PORT || 10000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on ${PORT}`);
});
// health
app.get('/ping', (req, res) => {
  res.status(200).json({ ok: true });
});

// ROOT ROUTE (THIS IS WHAT YOU ARE MISSING)
app.get('/', (req, res) => {
  res.send('API is running');
});