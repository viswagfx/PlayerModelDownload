import express from "express";

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.post("/api/userid", async (req, res) => {
  const username = String(req.body?.username || "").trim();
  if (!username) return res.status(400).json({ error: "username required" });

  const r = await fetch("https://users.roproxy.com/v1/usernames/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      usernames: [username],
      excludeBannedUsers: false
    })
  });

  const j = await r.json();
  if (!r.ok) return res.status(r.status).json(j);

  const id = j?.data?.[0]?.id;
  if (!id) return res.status(404).json({ error: "user not found" });

  res.json({ id });
});

app.listen(3000, () => console.log("✅ http://localhost:3000"));
