// server/server.js

require('dotenv').config();

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// ===== MIDDLEWARE =====
app.use(cors());
app.use(express.json());

// Serve static frontend (optional)
app.use(express.static(path.join(__dirname, '..')));

// ===== MULTER SETUP =====
const upload = multer({
  dest: path.join(__dirname, 'tmp'),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// ===== ENV VALIDATION =====
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Missing Supabase ENV variables");
  process.exit(1);
}

// ===== SUPABASE CLIENT =====
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// ===== HEALTH CHECK =====
app.get('/ping', (req, res) => {
  res.json({ ok: true });
});

// Optional root debug
app.get('/', (req, res) => {
  res.send('Server is alive');
});

// ===== SAVE VISIT =====
app.post('/save-visit', upload.array('files'), async (req, res) => {
  try {
    const { host, department, purpose, company, date, time, visitors } = req.body;

    if (!visitors) {
      return res.status(400).json({ error: "Visitors data missing" });
    }

    const parsedVisitors = JSON.parse(visitors);

    // 1. Create session
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

    // 2. Process visitors
    for (let i = 0; i < parsedVisitors.length; i++) {
      let fileUrl = null;

      if (req.files && req.files[i]) {
        const file = req.files[i];
        const stream = fs.createReadStream(file.path);

        const safeName = file.originalname.replace(/\s+/g, '_');
        const filePath = `ids/session_${session.id}_${Date.now()}_${safeName}`;

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

    // 3. Insert visitors
    const { error: visitorsError } = await supabase
      .from('visitors')
      .insert(results);

    if (visitorsError) throw visitorsError;

    res.json({ success: true });

  } catch (err) {
    console.error("❌ SAVE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===== GET SESSIONS =====
app.get('/sessions', async (req, res) => {
  try {
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
    console.error("❌ FETCH ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===== START SERVER =====
const PORT = process.env.PORT || 10000;

console.log("🚀 ENV PORT =", process.env.PORT);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on ${PORT}`);
});