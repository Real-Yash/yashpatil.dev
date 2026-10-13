const json = (payload, status = 200) =>
  Response.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== "/api/contact") return env.ASSETS.fetch(request);
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

    try {
      const form = await request.formData();
      const name = String(form.get("name") || "").trim();
      const email = String(form.get("email") || "").trim();
      const message = String(form.get("message") || "").trim();
      const honeypot = String(form.get("website") || "").trim();

      if (honeypot) return json({ ok: true });
      if (!name || !email || !message || name.length > 120 || email.length > 254 || message.length > 5000) {
        return json({ error: "Please provide a valid name, email address, and message." }, 400);
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json({ error: "Please provide a valid email address." }, 400);
      }

      await env.CONTACTS
        .prepare("INSERT INTO contact_messages (name, email, message, created_at) VALUES (?, ?, ?, ?)")
        .bind(name, email, message, new Date().toISOString())
        .run();

      return json({ ok: true, message: "Your note has been pinned. I’ll get back to you soon!" });
    } catch (error) {
      console.error("Contact form submission failed", error);
      return json({ error: "Unable to send your message right now. Please try again shortly." }, 500);
    }
  },
};
