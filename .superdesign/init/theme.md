# Theme

## Compact token summary

- Paper: `#fdfaf6`; ink: `#1a1a1a`; orange: `#fb923c`; yellow: `#fef08a`; red: `#ef4444`; blue: `#60a5fa`.
- Body font: Patrick Hand; heading font: Kalam.
- Border: `3px solid #1a1a1a`; hand-drawn radius: `255px 15px 225px 15px / 15px 225px 15px 255px`.
- Card shadow: `6px 6px 0 #1a1a1a`; hover shadow: `3px 3px 0 #1a1a1a`.
- Main desktop content: `max-w-6xl`; product grid: one column mobile, two columns at `md`.

## Source styling

```css
:root { --paper: #fdfaf6; --ink: #1a1a1a; --orange: #fb923c; --yellow: #fef08a; --red: #ef4444; --blue: #60a5fa; --wobbly-radius: 255px 15px 225px 15px / 15px 225px 15px 255px; }
body { font-family: 'Patrick Hand', cursive; color: var(--ink); background-color: var(--paper); background-image: radial-gradient(#e5e0d8 1.5px, transparent 0); background-size: 32px 32px; }
.heading-font { font-family: 'Kalam', cursive; }
.wobbly-border { border: 3px solid var(--ink); border-radius: var(--wobbly-radius); }
.hard-shadow { box-shadow: 6px 6px 0 var(--ink); transition: all .2s cubic-bezier(.175,.885,.32,1.275); }
.tape { width: 80px; height: 25px; background: rgba(229,224,216,.5); position: absolute; z-index: 10; }
.thumbtack { width: 14px; height: 14px; background: var(--red); border: 2px solid var(--ink); border-radius: 50%; position: absolute; }
```

