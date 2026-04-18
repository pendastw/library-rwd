const express = require('express');
const path = require('path');
const app = express();

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/search',   (req, res) => require('./api/search')(req, res));
app.get('/api/detail',   (req, res) => require('./api/detail')(req, res));
app.get('/api/booklist', (req, res) => require('./api/booklist')(req, res));
app.get('/api/ranking',  (req, res) => require('./api/ranking')(req, res));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server ready on http://localhost:${PORT}`));
