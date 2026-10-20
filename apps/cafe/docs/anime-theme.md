# Anime Theme — Design Guidelines

## 1. Overall Vibe

A clean, modern **anime/manga-inspired** look — energetic and fun for customers, but still fast-loading and easy to read on a phone. Think "cozy anime cafe" rather than busy/cluttered — the food and ordering flow must stay easy to use.

## 2. Color Palette

**Primary (pick one direction):**

- **Sakura / Pastel Anime:** soft pink `#FFB7C5`, cream white `#FFF8F0`, deep plum `#4A2C4D`, mint accent `#A0E7C4`
- **Shonen / Bold Anime:** vivid red `#E63946`, jet black `#1D1D1D`, electric blue `#3A86FF`, sunburst yellow `#FFD60A`
- **Studio Ghibli / Cozy:** warm cream `#F4EBD9`, forest green `#3C6E47`, terracotta `#D98E73`, soft brown `#6B4226`

Pick **one** palette and stay consistent — don't mix all three.

**Usage:**

- Background: light/cream base for readability of menu text
- Accent color: buttons, "Add to cart", status badges
- Dark color: text, headers

## 3. Typography

- **Headers/Logo:** a bold, rounded, slightly playful display font (e.g. "Baloo 2", "Fredoka", "M PLUS Rounded 1c" — has great Japanese-inspired rounded feel, free on Google Fonts)
- **Body/menu text:** a clean, highly legible sans-serif (e.g. "Inter", "Nunito", "Poppins") — anime styling should stay in headers/accents, not run into small item descriptions
- Avoid overly stylized/hard-to-read fonts for prices and item names — customers need to read these fast

## 4. Visual Elements

- **Mascot character:** a small chibi-style mascot (cafe staff character or the cafe's "spirit") that appears on the order confirmation screen, empty states ("no orders yet"), and loading screens
- **Speech-bubble UI accents:** order confirmations or status updates styled like manga speech bubbles ("Order received! (๑˃ᴗ˂)ﻭ")
- **Rounded corners everywhere:** cards, buttons, menu items — avoids a "corporate SaaS" look
- **Subtle sparkle/petal animations:** e.g. a light particle effect (sakura petals or sparkles) on successful order placement — keep it brief (1–2 sec) so it doesn't slow down repeat use
- **Category icons:** small anime-style icons for menu categories (drinks, snacks, desserts) instead of plain text labels
- **Status badges styled like "power-up" tags:** e.g. "Preparing ⚡" "Ready ✨" instead of plain gray text

## 5. Page-by-Page Notes

**Customer Order Page**

- Hero banner at top: cafe name in themed font + mascot illustration
- Menu as card grid with rounded item cards, item image (or icon if no photo), name, price, "+ Add" button in accent color
- Cart drawer/bottom sheet slides up with a playful transition
- Order confirmation: mascot + speech bubble + order number, shown big and clear

**Staff View**

- Keep this **more functional/less decorative** — staff need speed, not animation, during rush hours
- Light theming only: accent colors on status buttons, maybe a small mascot in the header
- New order alert: a distinct color flash/border + sound, not just a toast

## 6. Implementation Notes

- Use **CSS variables** for the palette so theme colors are centralized and easy to swap later
- Google Fonts (free) for headers + body — load only the weights used, to keep the page light for mobile data
- Keep animations CSS-based (transforms/opacity), avoid heavy JS animation libraries — page needs to load fast on cafe wifi/mobile data
- Mascot/illustrations: can start with free anime-style icon packs (e.g. from Flaticon/Icons8 licensed sets) or a simple custom-generated mascot; avoid using copyrighted anime characters or studio IP directly

## 7. Things to Avoid

- Don't reference or reuse existing copyrighted anime characters, series names, or studio branding (legal risk + inconsistent brand identity)
- Don't let decorative elements slow down the actual ordering flow — theme should feel light and fast, not heavy
- Don't over-animate the staff app — it needs to prioritize speed and clarity during busy hours
