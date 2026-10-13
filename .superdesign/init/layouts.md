# Layouts

## Home navigation and footer

- Source: `public/index.html`
- Description: Fixed white hand-drawn navigation card and a three-column footer.

```html
<nav class="fixed top-6 left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-4xl">
  <div class="bg-white wobbly-border hard-shadow px-8 py-4 flex items-center justify-between">
    <a href="#top" class="heading-font text-2xl font-bold">yashbytes</a>
    <div class="hidden md:flex gap-8 text-xl">…</div>
  </div>
</nav>
<footer class="py-12 px-6 bg-white/50">
  <div class="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">…</div>
</footer>
```

