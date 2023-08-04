import express from "express";
import path from "path";
import compression from "compression";

const app = express();
app.use(compression());

const PORT = 8000;

app.use(express.static(path.join(__dirname, "../www")));

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
