const { brandSlug } = require('./brand-domains');

const BRAND_COLORS = {
  'fender': { accent: '#C8102E', bg: '#121212' },
  'gibson': { accent: '#F5C518', bg: '#1a1400' },
  'yamaha': { accent: '#6B2D8B', bg: '#140a1a' },
  'shure': { accent: '#00A651', bg: '#0a1a10' },
  'audio-technica': { accent: '#003DA5', bg: '#0a1020' },
  'focusrite': { accent: '#E4002B', bg: '#1a0808' },
  'universal-audio': { accent: '#0072CE', bg: '#081018' },
  'behringer': { accent: '#FF6600', bg: '#1a1008' },
  'roland': { accent: '#E4002B', bg: '#180808' },
  'boss': { accent: '#FF6600', bg: '#1a1008' },
  'pearl': { accent: '#C8C8C8', bg: '#1a1a1a' },
  'akai': { accent: '#E4002B', bg: '#180808' },
  'allen-heath': { accent: '#7B68EE', bg: '#101018' },
  'arturia': { accent: '#FF3366', bg: '#180810' },
  'moog': { accent: '#F5C518', bg: '#1a1500' },
  'korg': { accent: '#00B4D8', bg: '#081418' },
  'neumann': { accent: '#C0C0C0', bg: '#141414' },
  'sennheiser': { accent: '#003DA5', bg: '#081018' },
  'ibanez': { accent: '#E4002B', bg: '#180808' },
  'taylor': { accent: '#8B7355', bg: '#141008' },
  'martin': { accent: '#C0A060', bg: '#141008' },
  'presonus': { accent: '#003DA5', bg: '#081018' },
  'mackie': { accent: '#00A651', bg: '#081410' },
  'jbl': { accent: '#FF6600', bg: '#1a1008' },
  'mogami': { accent: '#FFD700', bg: '#141200' },
  'earthquaker': { accent: '#7FFF00', bg: '#101408' },
  'strymon': { accent: '#4DA3FF', bg: '#081018' },
  'nord': { accent: '#E4002B', bg: '#180808' },
  'alesis': { accent: '#00B4D8', bg: '#081418' },
  'm-audio': { accent: '#FF6600', bg: '#1a1008' }
};

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * High-quality scalable SVG badge (400×200 viewBox) for 4K TV display.
 * Used when web logo fetch fails or returns tiny images.
 */
function generateBrandSvg(brandName) {
  const slug = brandSlug(brandName);
  const colors = BRAND_COLORS[slug] || { accent: '#4DA3FF', bg: '#1a2332' };
  const words = brandName.trim().split(/\s+/);
  const line1 = words.length > 2 ? words.slice(0, 2).join(' ') : brandName;
  const line2 = words.length > 2 ? words.slice(2).join(' ') : '';
  const fs1 = line1.length > 14 ? 52 : line1.length > 10 ? 60 : 72;
  const fs2 = 40;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400" width="800" height="400">
  <rect x="24" y="24" width="752" height="352" rx="20" fill="#1e2836" stroke="${colors.accent}" stroke-width="3"/>
  <text x="400" y="${line2 ? 175 : 210}" text-anchor="middle" fill="#f0f4f8"
    font-family="Segoe UI,Helvetica,Arial,sans-serif" font-size="${fs1}" font-weight="700"
    letter-spacing="2">${escapeXml(line1)}</text>
  ${line2 ? `<text x="400" y="250" text-anchor="middle" fill="#d0dae8"
    font-family="Segoe UI,Helvetica,Arial,sans-serif" font-size="${fs2}" font-weight="600"
    letter-spacing="1">${escapeXml(line2)}</text>` : ''}
</svg>`;
}

module.exports = { generateBrandSvg, BRAND_COLORS };