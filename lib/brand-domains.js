/**
 * Maps studio gear brand names to their official website domains for logo lookup.
 * Used with Clearbit Logo API and Google favicon fallback.
 */
const BRAND_DOMAINS = {
  'fender': 'fender.com',
  'gibson': 'gibson.com',
  'yamaha': 'yamaha.com',
  'shure': 'shure.com',
  'audio-technica': 'audio-technica.com',
  'focusrite': 'focusrite.com',
  'universal-audio': 'uaudio.com',
  'behringer': 'behringer.com',
  'roland': 'roland.com',
  'boss': 'boss.info',
  'pearl': 'pearldrum.com',
  'akai': 'akaipro.com',
  'allen-heath': 'allen-heath.com',
  'arturia': 'arturia.com',
  'moog': 'moogmusic.com',
  'korg': 'korg.com',
  'neumann': 'neumann.com',
  'sennheiser': 'sennheiser.com',
  'ibanez': 'ibanez.com',
  'taylor': 'taylorguitars.com',
  'martin': 'martinguitar.com',
  'presonus': 'presonus.com',
  'mackie': 'mackie.com',
  'jbl': 'jbl.com',
  'mogami': 'mogamicable.com',
  'earthquaker': 'earthquakerdevices.com',
  'strymon': 'strymon.net',
  'nord': 'nordkeyboards.com',
  'alesis': 'alesis.com',
  'm-audio': 'm-audio.com',
  'ableton': 'ableton.com',
  'akg': 'akg.com',
  'electro-harmonix': 'ehx.com',
  'mesa-boogie': 'mesaboogie.com',
  'orange': 'orangeamps.com',
  'marshall': 'marshall.com',
  'vox': 'voxamps.com',
  'line-6': 'line6.com',
  'tc-electronic': 'tcelectronic.com',
  'eventide': 'eventideaudio.com',
  'warm-audio': 'warmaudio.com',
  'ssl': 'solidstatelogic.com',
  'avid': 'avid.com',
  'steinberg': 'steinberg.net',
  'eurorack': 'mutable-instruments.net'
};

function brandSlug(name) {
  return String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function resolveDomain(brandName) {
  const slug = brandSlug(brandName);
  if (BRAND_DOMAINS[slug]) return BRAND_DOMAINS[slug];

  // Heuristic: "Some Brand Inc" -> somebrand.com
  const compact = slug.replace(/-/g, '');
  if (compact.length >= 3) return `${compact}.com`;

  return null;
}

module.exports = { BRAND_DOMAINS, brandSlug, resolveDomain };