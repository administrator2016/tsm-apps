
const { externalLlmFetch } = require('./server/external-llm-policy');
const GROQ_API_KEY = process.env.GROQ_API_KEY;
module.exports = function(app) {
  app.post("/api/groq", async (req, res) => {
    const { messages, system } = req.body;
    if (!messages) return res.status(400).json({ error: "messages required" });
    if (!GROQ_API_KEY) return res.status(500).json({ error: "GROQ_API_KEY not set" });
    try {
      const response = await externalLlmFetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-120b",
          messages: system ? [{ role: "system", content: system }, ...messages] : messages,
          temperature: 0.3,
          max_tokens: 1024,
        }),
      });
      const data = await response.json();
      if (!response.ok) return res.status(500).json({ error: data.error?.message || "Groq error" });
      if (!data.choices?.[0]) return res.status(500).json({ error: "No choices returned", raw: data });
      res.json({ content: data.choices[0].message.content });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
