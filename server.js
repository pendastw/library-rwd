const express = require('express');
const path = require('path');
const app = express();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/api/search',   (req, res) => require('./api/search')(req, res));
app.get('/api/detail',   (req, res) => require('./api/detail')(req, res));
app.get('/api/booklist', (req, res) => require('./api/booklist')(req, res));
app.get('/api/ranking',  (req, res) => require('./api/ranking')(req, res));

app.post('/api/login',      (req, res) => require('./api/auth').login(req, res));
app.post('/api/logout',     (req, res) => require('./api/auth').logout(req, res));
app.get('/api/auth-status', (req, res) => require('./api/auth').status(req, res));
app.get('/api/personal',    (req, res) => require('./api/personal')(req, res));
app.get('/api/reserve',     (req, res) => require('./api/reserve')(req, res));
app.post('/api/reserve',    (req, res) => require('./api/reserve')(req, res));
app.post('/api/myaction',   (req, res) => require('./api/myaction')(req, res));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server ready on http://localhost:${PORT}`));
