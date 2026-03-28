const express = require('express');
const app = express();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const compensi = [35, 15, 7, 3, 2.5, 2, 1.5, 1];

// REGISTRAZIONE
app.post('/register', async (req, res) => {
  const { nome, email, password, sponsor_id } = req.body;

  const hash = await bcrypt.hash(password, 10);

  const result = await pool.query(
    `INSERT INTO users (nome,email,password,sponsor_id,contratti_validati_count,created_at)
     VALUES ($1,$2,$3,$4,0,NOW()) RETURNING id`,
    [nome, email, hash, sponsor_id || null]
  );

  res.json({ user_id: result.rows[0].id });
});

// LOGIN
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  const result = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
  if (!result.rows.length) return res.status(404).send('Utente non trovato');

  const user = result.rows[0];
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).send('Password errata');

  const token = jwt.sign({ id: user.id }, 'secret');
  res.json({ token, user_id: user.id });
});

// CONTRATTI
app.post('/contratti', async (req, res) => {
  const { user_id, cliente_nome, tipo } = req.body;

  const result = await pool.query(
    `INSERT INTO contracts (user_id,cliente_nome,tipo,stato,created_at)
     VALUES ($1,$2,$3,'inserito',NOW()) RETURNING id`,
    [user_id, cliente_nome, tipo]
  );

  res.json({ contract_id: result.rows[0].id });
});

// VALIDAZIONE
app.post('/admin/valida', async (req, res) => {
  const { contract_id } = req.body;

  await pool.query(`UPDATE contracts SET stato='validato' WHERE id=$1`, [contract_id]);

  const c = await pool.query(`SELECT user_id FROM contracts WHERE id=$1`, [contract_id]);
  let userId = c.rows[0].user_id;

  await pool.query(`UPDATE users SET contratti_validati_count = contratti_validati_count + 1 WHERE id=$1`, [userId]);

  const u = await pool.query(`SELECT * FROM users WHERE id=$1`, [userId]);
  const user = u.rows[0];

  let corrente = user.contratti_validati_count < 3 ? user.sponsor_id : userId;

  for (let i = 0; i < compensi.length; i++) {
    if (!corrente) break;

    const totale = compensi[i];
    const mensile = totale / 12;

    const dataInizio = new Date();
    dataInizio.setDate(dataInizio.getDate() + 90);

    await pool.query(
      `INSERT INTO commissions 
      (user_id, contract_id, livello, importo_totale, importo_mensile, mesi_totali, mesi_pagati, data_inizio)
      VALUES ($1,$2,$3,$4,$5,12,0,$6)`,
      [corrente, contract_id, i + 1, totale, mensile, dataInizio]
    );

    const next = await pool.query(`SELECT sponsor_id FROM users WHERE id=$1`, [corrente]);
    corrente = next.rows[0]?.sponsor_id;
  }

  res.send('OK');
});

app.listen(3000, () => console.log('Backend attivo'));
