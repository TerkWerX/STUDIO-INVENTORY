const BOOLEAN_TRUE = new Set([true, 1, '1', 'true', 'yes', 'on']);

const field = (key, label, type = 'text', options = {}) => ({ key, label, type, ...options });
const accessory = (name, category = 'Instrument Accessory', instrumentType = 'instrument_accessory', options = {}) => ({
  name,
  category,
  instrument_type: instrumentType,
  ...options
});

const brassCare = [
  accessory('Mouthpiece', 'Instrument Accessory', 'brass_mouthpiece'),
  accessory('Protective case'),
  accessory('Cleaning snake / brush kit'),
  accessory('Music stand')
];

const brassCommonFields = [
  field('instrument_key', 'Key', 'text', { placeholder: 'e.g. B♭, C, F' }),
  field('bore_size', 'Bore size', 'text', { placeholder: 'e.g. .459 in' }),
  field('bell_diameter', 'Bell diameter', 'text', { placeholder: 'e.g. 4.75 in' }),
  field('valve_type', 'Valve type', 'select', { options: ['Piston', 'Rotary', 'Slide only', 'Other'] }),
  field('valve_count', 'Valve count', 'number', { min: 0, max: 8, step: 1 }),
  field('finish', 'Finish / plating', 'text', { placeholder: 'e.g. lacquered brass, silver plate' }),
  field('mouthpiece', 'Primary mouthpiece', 'text', { placeholder: 'Brand, model, and size' })
];

const bowedFields = [
  field('instrument_size', 'Instrument size', 'select', { options: ['1/16', '1/10', '1/8', '1/4', '1/2', '3/4', '7/8', '4/4 (full size)', 'Other'] }),
  field('instrument_format', 'Acoustic / electric format', 'select', { options: ['Acoustic', 'Acoustic-electric', 'Electric', 'Silent/practice'] }),
  field('string_count', 'Number of strings', 'number', { min: 1, max: 12, step: 1 }),
  field('string_set', 'Installed string set', 'text', { placeholder: 'Brand, model, and gauge/tension' }),
  field('body_top', 'Top wood / material', 'text'),
  field('body_back_sides', 'Back and sides material', 'text'),
  field('pickup_type', 'Pickup / transducer', 'text', { placeholder: 'Type and model, if equipped' }),
  field('electronics_mode', 'Electronics', 'select', { options: ['None / passive acoustic', 'Passive pickup', 'Active preamp', 'Digital/modeling'] }),
  field('battery_type', 'Electronics battery', 'text', { placeholder: 'e.g. 9V, AA × 2, rechargeable' }),
  field('bow_brand_model', 'Bow brand / model', 'text'),
  field('bow_material', 'Bow stick material', 'select', { options: ['Pernambuco', 'Brazilwood', 'Carbon fiber', 'Fiberglass', 'Composite', 'Other'] }),
  field('bow_length', 'Bow length', 'text', { placeholder: 'e.g. full size, 29.5 in' }),
  field('bow_weight', 'Bow weight', 'text', { placeholder: 'e.g. 60 g' }),
  field('bow_frog', 'Bow frog / fittings', 'text'),
  field('bow_hair', 'Bow hair', 'text', { placeholder: 'e.g. white horsehair, synthetic' })
];

const bowedAccessories = (restName) => [
  accessory('Bow', 'Instrument Accessory', 'bow'),
  accessory('Protective case'),
  accessory(restName),
  accessory('Rosin'),
  accessory('Spare string set'),
  accessory('Humidifier / hygrometer')
];

const frettedFields = [
  field('body_style', 'Body style', 'text', { placeholder: 'e.g. solid body, dreadnought, hollow body' }),
  field('string_count', 'Number of strings', 'number', { min: 4, max: 18, step: 1 }),
  field('handedness', 'Handedness', 'select', { options: ['Right-handed', 'Left-handed', 'Ambidextrous/custom'] }),
  field('scale_length', 'Scale length', 'text', { placeholder: 'e.g. 25.5 in' }),
  field('neck_profile', 'Neck profile / material', 'text'),
  field('fret_count', 'Fret count', 'number', { min: 0, max: 36, step: 1 }),
  field('pickup_configuration', 'Pickup configuration', 'text', { placeholder: 'e.g. SSS, HH, piezo' }),
  field('electronics_mode', 'Electronics', 'select', { options: ['Passive', 'Active', 'Acoustic only', 'Hybrid/modeling'] }),
  field('battery_type', 'Electronics battery', 'text', { placeholder: 'e.g. 9V, AA × 2, rechargeable' }),
  field('bridge_type', 'Bridge / tremolo', 'text'),
  field('installed_strings', 'Installed strings', 'text', { placeholder: 'Brand and gauge' }),
  field('finish', 'Finish / color', 'text')
];

const instrumentProfiles = [
  {
    id: 'trumpet', label: 'Trumpet', group: 'Brass', category: 'Brass Instrument',
    fields: [...brassCommonFields, field('trumpet_type', 'Trumpet type', 'select', { options: ['Standard', 'Piccolo', 'Pocket', 'Bass', 'Herald', 'Other'] }), field('leadpipe', 'Leadpipe / receiver', 'text')],
    suggestedAccessories: [...brassCare, accessory('Valve oil'), accessory('Slide grease'), accessory('Mute')]
  },
  {
    id: 'trombone', label: 'Trombone', group: 'Brass', category: 'Brass Instrument',
    fields: [...brassCommonFields, field('trombone_range', 'Trombone type', 'select', { options: ['Tenor', 'Bass', 'Alto', 'Soprano', 'Contrabass', 'Other'] }), field('slide_type', 'Slide / attachment configuration', 'text', { placeholder: 'e.g. straight, F-attachment, dependent valves' }), field('slide_material', 'Inner/outer slide material', 'text')],
    suggestedAccessories: [...brassCare, accessory('Slide cream / lubricant'), accessory('Water spray bottle'), accessory('Rotor oil', 'Instrument Accessory', 'instrument_accessory', { optional: true }), accessory('Mute')]
  },
  {
    id: 'french_horn', label: 'French horn', group: 'Brass', category: 'Brass Instrument',
    fields: [...brassCommonFields, field('horn_configuration', 'Horn configuration', 'select', { options: ['Single', 'Double', 'Triple', 'Descant', 'Other'] }), field('bell_type', 'Bell', 'select', { options: ['Fixed', 'Detachable', 'Other'] }), field('wrap_style', 'Wrap / linkage', 'text')],
    suggestedAccessories: [...brassCare, accessory('Rotor oil'), accessory('Bearing/linkage oil'), accessory('Slide grease'), accessory('Mute')]
  },
  {
    id: 'euphonium_baritone', label: 'Euphonium / baritone horn', group: 'Brass', category: 'Brass Instrument',
    fields: [...brassCommonFields, field('compensating_system', 'Compensating system', 'select', { options: ['Non-compensating', 'Compensating', 'Double-bell', 'Other'] }), field('valve_layout', 'Valve layout', 'text', { placeholder: 'e.g. 3+1, four inline' })],
    suggestedAccessories: [...brassCare, accessory('Valve oil'), accessory('Slide grease'), accessory('Mute')]
  },
  {
    id: 'tuba', label: 'Tuba', group: 'Brass', category: 'Brass Instrument',
    fields: [...brassCommonFields, field('tuba_pitch', 'Pitch / type', 'select', { options: ['BB♭', 'CC', 'E♭', 'F', 'Other'] }), field('valve_layout', 'Valve layout', 'text'), field('body_size', 'Body size', 'text', { placeholder: 'e.g. 3/4, 4/4, 5/4, 6/4' })],
    suggestedAccessories: [...brassCare, accessory('Valve or rotor oil'), accessory('Slide grease'), accessory('Playing stand')]
  },
  {
    id: 'brass_mouthpiece', label: 'Brass mouthpiece', group: 'Brass Components', category: 'Instrument Accessory',
    fields: [field('for_instrument', 'For instrument', 'text'), field('mouthpiece_size', 'Size / designation', 'text'), field('cup_depth', 'Cup depth / shape', 'text'), field('cup_diameter', 'Cup diameter', 'text'), field('rim_profile', 'Rim profile', 'text'), field('throat_backbore', 'Throat / backbore', 'text'), field('finish', 'Material / finish', 'text')],
    suggestedAccessories: [accessory('Mouthpiece pouch'), accessory('Mouthpiece brush')]
  },
  {
    id: 'violin', label: 'Violin', group: 'Bowed Strings', category: 'Bowed String Instrument', fields: bowedFields,
    suggestedAccessories: bowedAccessories('Shoulder rest')
  },
  {
    id: 'viola', label: 'Viola', group: 'Bowed Strings', category: 'Bowed String Instrument', fields: [...bowedFields, field('body_length', 'Viola body length', 'text', { placeholder: 'e.g. 15.5 in, 16 in' })],
    suggestedAccessories: bowedAccessories('Shoulder rest')
  },
  {
    id: 'cello', label: 'Cello', group: 'Bowed Strings', category: 'Bowed String Instrument', fields: [...bowedFields, field('endpin', 'Endpin type / material', 'text')],
    suggestedAccessories: bowedAccessories('Endpin stop / anchor')
  },
  {
    id: 'double_bass', label: 'Double bass', group: 'Bowed Strings', category: 'Bowed String Instrument', fields: [...bowedFields, field('bass_shape', 'Body shape', 'select', { options: ['Gamba', 'Violin', 'Busetto', 'Other'] }), field('bow_style', 'Bow style', 'select', { options: ['French', 'German', 'Both / other'] })],
    suggestedAccessories: bowedAccessories('Endpin stop / anchor')
  },
  {
    id: 'bow', label: 'Bowed-string bow', group: 'Bowed String Components', category: 'Instrument Accessory',
    fields: [field('for_instrument', 'For instrument', 'text'), field('bow_size', 'Size', 'text'), field('bow_material', 'Stick material', 'text'), field('bow_length', 'Length', 'text'), field('bow_weight', 'Weight', 'text'), field('bow_frog', 'Frog / fittings', 'text'), field('bow_hair', 'Hair', 'text'), field('balance_point', 'Balance point', 'text')],
    suggestedAccessories: [accessory('Bow case / tube'), accessory('Rosin')]
  },
  {
    id: 'electric_guitar', label: 'Electric guitar', group: 'Guitars & Basses', category: 'Guitar', fields: frettedFields,
    suggestedAccessories: [accessory('Protective case'), accessory('Instrument cable'), accessory('Strap'), accessory('Spare string set'), accessory('Picks'), accessory('Guitar stand'), accessory('Battery', 'Instrument Accessory', 'instrument_accessory', { optional: true })]
  },
  {
    id: 'acoustic_guitar', label: 'Acoustic / acoustic-electric guitar', group: 'Guitars & Basses', category: 'Guitar', fields: [...frettedFields, field('top_wood', 'Top wood', 'text'), field('back_sides_wood', 'Back / sides wood', 'text')],
    suggestedAccessories: [accessory('Protective case'), accessory('Strap'), accessory('Spare string set'), accessory('Picks'), accessory('Capo'), accessory('Humidifier / hygrometer'), accessory('Instrument cable', 'Instrument Accessory', 'instrument_accessory', { optional: true })]
  },
  {
    id: 'electric_bass', label: 'Electric bass', group: 'Guitars & Basses', category: 'Bass', fields: frettedFields,
    suggestedAccessories: [accessory('Protective case'), accessory('Instrument cable'), accessory('Strap'), accessory('Spare string set'), accessory('Bass stand'), accessory('Battery', 'Instrument Accessory', 'instrument_accessory', { optional: true })]
  },
  {
    id: 'keyboard', label: 'Keyboard / digital piano', group: 'Keys', category: 'Keyboard',
    fields: [field('key_count', 'Number of keys', 'number', { min: 1, max: 128, step: 1 }), field('key_action', 'Key action', 'select', { options: ['Synth', 'Semi-weighted', 'Hammer action', 'Graded hammer', 'Other'] }), field('velocity_aftertouch', 'Velocity / aftertouch', 'text'), field('polyphony', 'Maximum polyphony', 'text'), field('sound_engine', 'Sound engine', 'text'), field('pedal_inputs', 'Pedal inputs', 'text'), field('audio_outputs', 'Audio outputs', 'text'), field('midi_connections', 'MIDI / USB connections', 'text'), field('speaker_system', 'Built-in speakers', 'text'), field('battery_type', 'Battery type', 'text')],
    suggestedAccessories: [accessory('Keyboard stand'), accessory('Sustain pedal'), accessory('Expression pedal', 'Instrument Accessory', 'instrument_accessory', { optional: true }), accessory('Bench'), accessory('Protective case'), accessory('Audio cables'), accessory('MIDI / USB cable')]
  },
  {
    id: 'electronic_drum_kit', label: 'Electronic drum kit', group: 'Drums', category: 'Electronic Drum Kit',
    fields: [field('kit_configuration', 'Kit configuration / combined sets', 'textarea', { placeholder: 'e.g. Two combined Alesis Command Mesh kits' }), field('module_count', 'Number of modules', 'number', { min: 0, max: 16, step: 1 }), field('module_models', 'Module model(s)', 'text'), field('rack_system', 'Rack system / tube diameter', 'text'), field('snare_count', 'Snare pads', 'number', { min: 0, max: 32, step: 1 }), field('tom_count', 'Tom pads', 'number', { min: 0, max: 32, step: 1 }), field('kick_count', 'Kick pads / towers', 'number', { min: 0, max: 16, step: 1 }), field('cymbal_count', 'Cymbal / hi-hat pads', 'number', { min: 0, max: 32, step: 1 }), field('trigger_inputs', 'Available trigger inputs', 'text'), field('expansion_inputs', 'Expansion inputs in use / available', 'text'), field('hi_hat_system', 'Hi-hat system / controller', 'text'), field('kick_system', 'Kick pedal / tower configuration', 'text'), field('midi_usb', 'MIDI / USB connections', 'text'), field('audio_routing', 'Audio outputs / routing', 'text')],
    suggestedAccessories: [accessory('Drum module', 'Electronic Drum Component', 'edrum_module'), accessory('Snare pad', 'Electronic Drum Component', 'drum_pad', { specs: { pad_role: 'Snare' } }), accessory('Tom pad', 'Electronic Drum Component', 'drum_pad', { specs: { pad_role: 'Tom' }, repeatable: true }), accessory('Kick pad / tower', 'Electronic Drum Component', 'drum_pad', { specs: { pad_role: 'Kick' } }), accessory('Hi-hat pad / controller', 'Electronic Drum Component', 'cymbal_pad', { specs: { cymbal_role: 'Hi-hat' } }), accessory('Crash cymbal pad', 'Electronic Drum Component', 'cymbal_pad', { specs: { cymbal_role: 'Crash' }, repeatable: true }), accessory('Ride cymbal pad', 'Electronic Drum Component', 'cymbal_pad', { specs: { cymbal_role: 'Ride' } }), accessory('Trigger cable snake', 'Electronic Drum Component', 'trigger_cable_snake'), accessory('Rack clamps and mounts', 'Drum Hardware', 'drum_hardware', { repeatable: true }), accessory('Kick / hi-hat pedals', 'Drum Hardware', 'drum_hardware'), accessory('Power supply'), accessory('Drum throne')]
  },
  {
    id: 'edrum_module', label: 'Electronic drum module', group: 'Electronic Drum Components', category: 'Electronic Drum Component',
    fields: [field('trigger_input_count', 'Trigger input count', 'number', { min: 0, max: 64, step: 1 }), field('snake_connector', 'Main snake connector', 'text'), field('individual_inputs', 'Individual / expansion inputs', 'text'), field('supported_zones', 'Supported trigger zones', 'text'), field('hi_hat_compatibility', 'Hi-hat compatibility', 'text'), field('midi_connections', 'MIDI connections', 'text'), field('usb_functions', 'USB functions', 'text'), field('audio_inputs', 'Audio inputs', 'text'), field('audio_outputs', 'Audio outputs', 'text'), field('firmware_version', 'Firmware version', 'text')],
    suggestedAccessories: [accessory('Trigger cable snake', 'Electronic Drum Component', 'trigger_cable_snake'), accessory('Power supply'), accessory('USB / MIDI cable'), accessory('Audio output cables')]
  },
  {
    id: 'electronic_percussion_controller', label: 'Electronic percussion controller / multipad', group: 'Electronic Drum Components', category: 'Electronic Drum Component',
    fields: [field('playing_pad_count', 'Playing pad count', 'number', { min: 1, max: 64, step: 1 }), field('external_trigger_inputs', 'External trigger inputs', 'text'), field('pedal_inputs', 'Pedal / footswitch inputs', 'text'), field('midi_connections', 'MIDI connections', 'text'), field('usb_functions', 'USB functions / connector', 'text'), field('audio_outputs', 'Audio outputs', 'text'), field('mount_pattern', 'Mount plate / hole pattern', 'text'), field('mount_thread', 'Mount screw thread / size', 'text'), field('compatible_mounts', 'Confirmed compatible mounts', 'text'), field('firmware_version', 'Firmware version', 'text')],
    suggestedAccessories: [accessory('Controller mounting plate', 'Mounting Hardware', 'equipment_mount'), accessory('Rack adapter clamp', 'Mounting Hardware', 'equipment_mount'), accessory('Mounting thumb screws', 'Fasteners / Small Hardware', 'fastener_hardware'), accessory('USB cable to DAW', 'Cable', 'audio_data_cable'), accessory('MIDI cable', 'Cable', 'audio_data_cable', { optional: true }), accessory('Power supply')]
  },
  {
    id: 'drum_pad', label: 'Electronic drum pad', group: 'Electronic Drum Components', category: 'Electronic Drum Component',
    fields: [field('pad_role', 'Pad role', 'select', { options: ['Snare', 'Tom', 'Kick', 'Auxiliary', 'Other'] }), field('diameter_inches', 'Diameter', 'text', { placeholder: 'e.g. 8 in, 10 in' }), field('playing_surface', 'Playing surface', 'select', { options: ['Mesh', 'Rubber', 'Silicone', 'Acoustic conversion', 'Other'] }), field('trigger_zones', 'Trigger zones', 'select', { options: ['Single-zone', 'Dual-zone', 'Triple-zone', 'Other'] }), field('rim_trigger', 'Rim trigger', 'boolean'), field('positional_sensing', 'Positional sensing', 'boolean'), field('connector_type', 'Connector', 'text', { placeholder: 'e.g. 1/4 in TRS' }), field('mount_type', 'Mount / clamp compatibility', 'text'), field('module_input', 'Assigned module input', 'text')],
    suggestedAccessories: [accessory('Pad cable'), accessory('L-rod / pad mount', 'Drum Hardware', 'drum_hardware'), accessory('Rack clamp', 'Drum Hardware', 'drum_hardware'), accessory('Replacement mesh head', 'Instrument Accessory', 'instrument_accessory', { optional: true })]
  },
  {
    id: 'cymbal_pad', label: 'Electronic cymbal / hi-hat pad', group: 'Electronic Drum Components', category: 'Electronic Drum Component',
    fields: [field('cymbal_role', 'Cymbal role', 'select', { options: ['Hi-hat', 'Crash', 'Ride', 'Splash', 'China', 'Auxiliary', 'Other'] }), field('diameter_inches', 'Diameter', 'text', { placeholder: 'e.g. 10 in, 12 in, 14 in' }), field('trigger_zones', 'Trigger zones', 'select', { options: ['Single-zone', 'Dual-zone', 'Triple-zone', 'Other'] }), field('choke_capable', 'Choke capable', 'boolean'), field('bell_zone', 'Separate bell zone', 'boolean'), field('edge_zone', 'Separate edge zone', 'boolean'), field('motion_type', 'Swing / rotation stopper', 'text'), field('connector_type', 'Connector(s)', 'text'), field('module_input', 'Assigned module input', 'text')],
    suggestedAccessories: [accessory('Cymbal cable'), accessory('Cymbal boom / arm', 'Drum Hardware', 'drum_hardware'), accessory('Rack clamp', 'Drum Hardware', 'drum_hardware'), accessory('Rotation stopper / felt set')]
  },
  {
    id: 'trigger_cable_snake', label: 'Electronic drum trigger snake', group: 'Electronic Drum Components', category: 'Electronic Drum Component',
    fields: [field('module_connector', 'Module-end connector', 'text'), field('breakout_count', 'Breakout cable count', 'number', { min: 1, max: 64, step: 1 }), field('pad_connectors', 'Pad-end connectors', 'text', { placeholder: 'e.g. labeled 1/4 in TRS/TS plugs' }), field('cable_length', 'Cable length', 'text'), field('label_map', 'Cable labels / input map', 'textarea'), field('compatible_modules', 'Compatible module(s)', 'text')],
    suggestedAccessories: [accessory('Cable labels'), accessory('Hook-and-loop cable ties'), accessory('Extension trigger cables')]
  },
  {
    id: 'drum_hardware', label: 'Drum rack / bracket / hardware', group: 'Drum Components', category: 'Drum Hardware',
    fields: [field('hardware_type', 'Hardware type', 'select', { options: ['Rack tube', 'Rack clamp', 'Multi-clamp', 'L-rod', 'Pad mount', 'Cymbal arm', 'Boom arm', 'Snare stand', 'Other stand', 'Pedal', 'Other'] }), field('tube_diameter', 'Tube / clamp diameter', 'text'), field('rod_thread_size', 'Rod / thread size', 'text'), field('mount_range', 'Adjustment / mounting range', 'text'), field('compatible_system', 'Confirmed compatible rack / brand', 'text'), field('incompatible_system', 'Known incompatibility', 'text'), field('compatibility_status', 'Compatibility result', 'select', { options: ['Confirmed compatible', 'Adapter required', 'Did not fit / incompatible', 'Untested', 'Modified to fit'] }), field('finish', 'Finish', 'text')],
    suggestedAccessories: [accessory('Memory lock'), accessory('Wing nuts / felts'), accessory('Spare clamp bolts')]
  },
  {
    id: 'acoustic_drum_kit', label: 'Acoustic drum kit', group: 'Drums', category: 'Drum Kit',
    fields: [field('kit_configuration', 'Kit configuration', 'textarea', { placeholder: 'Shell pack, add-on drums, and cymbal setup' }), field('shell_material', 'Shell material / plies', 'text'), field('bass_drum_size', 'Bass drum size', 'text'), field('snare_size', 'Snare size', 'text'), field('tom_sizes', 'Tom sizes', 'text'), field('bearing_edges', 'Bearing edges', 'text'), field('hoop_type', 'Hoop type', 'text'), field('finish', 'Finish / wrap', 'text')],
    suggestedAccessories: [accessory('Snare drum', 'Acoustic Drum Component', 'acoustic_drum'), accessory('Tom drum', 'Acoustic Drum Component', 'acoustic_drum', { repeatable: true }), accessory('Cymbal', 'Acoustic Drum Component', 'acoustic_cymbal', { repeatable: true }), accessory('Kick pedal', 'Drum Hardware', 'drum_hardware'), accessory('Hi-hat stand', 'Drum Hardware', 'drum_hardware'), accessory('Cymbal stands', 'Drum Hardware', 'drum_hardware'), accessory('Drum throne'), accessory('Drum cases')]
  },
  {
    id: 'acoustic_drum', label: 'Acoustic drum / shell', group: 'Drum Components', category: 'Acoustic Drum Component',
    fields: [field('drum_role', 'Drum type', 'select', { options: ['Snare', 'Rack tom', 'Floor tom', 'Bass drum', 'Concert tom', 'Other'] }), field('diameter_inches', 'Diameter', 'text'), field('depth_inches', 'Depth', 'text'), field('shell_material', 'Shell material / plies', 'text'), field('batter_head', 'Batter head', 'text'), field('resonant_head', 'Resonant head', 'text'), field('lug_count', 'Lug count', 'number', { min: 0, max: 32, step: 1 }), field('mount_type', 'Mount / leg system', 'text'), field('snare_wires', 'Snare wires / mechanism', 'text')],
    suggestedAccessories: [accessory('Protective case'), accessory('Spare drumheads'), accessory('Tuning key'), accessory('Mount / stand', 'Drum Hardware', 'drum_hardware')]
  },
  {
    id: 'acoustic_cymbal', label: 'Acoustic cymbal', group: 'Drum Components', category: 'Acoustic Drum Component',
    fields: [field('cymbal_role', 'Cymbal type', 'select', { options: ['Hi-hat pair', 'Crash', 'Ride', 'Crash/Ride', 'Splash', 'China', 'Effects', 'Other'] }), field('diameter_inches', 'Diameter', 'text'), field('weight_class', 'Weight / weight class', 'text'), field('alloy', 'Alloy', 'text'), field('finish', 'Finish', 'text'), field('hammering_lathing', 'Hammering / lathing', 'text'), field('rivets_sizzler', 'Rivets / sizzler', 'text')],
    suggestedAccessories: [accessory('Cymbal sleeve / felt set'), accessory('Protective cymbal bag'), accessory('Cymbal stand', 'Drum Hardware', 'drum_hardware')]
  },
  {
    id: 'equipment_mount', label: 'Equipment mount / adapter / clamp', group: 'Mounting & Small Hardware', category: 'Mounting Hardware',
    fields: [field('hardware_type', 'Mount type', 'select', { options: ['Mounting plate', 'Adapter bracket', 'Rack clamp', 'Multi-clamp', 'L-rod', 'Ball joint', 'Stand adapter', 'Shelf', 'Other'] }), field('mounts_item', 'Item being mounted', 'text'), field('mounts_to', 'Frame / stand / rack it mounts to', 'text'), field('mount_pattern', 'Hole / mounting pattern', 'text'), field('tube_diameter', 'Tube / clamp diameter', 'text'), field('thread_size', 'Thread / fastener size', 'text'), field('load_rating', 'Load rating', 'text'), field('compatible_system', 'Confirmed compatibility', 'text'), field('incompatible_system', 'Known incompatibility', 'text'), field('compatibility_status', 'Compatibility result', 'select', { options: ['Confirmed compatible', 'Adapter required', 'Did not fit / incompatible', 'Untested', 'Modified to fit'] }), field('adapter_chain', 'Required adapter chain', 'textarea', { placeholder: 'e.g. ControlPad plate → Gibraltar multi-clamp → Alesis rack tube' })],
    suggestedAccessories: [accessory('Mounting screws / thumb screws', 'Fasteners / Small Hardware', 'fastener_hardware'), accessory('Adapter clamp', 'Mounting Hardware', 'equipment_mount', { optional: true }), accessory('Memory lock / safety stop', 'Mounting Hardware', 'equipment_mount', { optional: true })]
  },
  {
    id: 'fastener_hardware', label: 'Fastener / thumb screw / small hardware', group: 'Mounting & Small Hardware', category: 'Fasteners / Small Hardware',
    fields: [field('fastener_type', 'Fastener type', 'select', { options: ['Thumb screw', 'Machine screw', 'Bolt', 'Nut', 'Washer', 'Wing nut', 'Spacer', 'Knob', 'Other'] }), field('thread_standard', 'Thread size / pitch', 'text', { placeholder: 'e.g. M6 × 1.0, 1/4-20' }), field('length', 'Length', 'text'), field('head_drive', 'Head / drive style', 'text'), field('material_finish', 'Material / finish', 'text'), field('mounts_item', 'Used to attach', 'text'), field('compatible_with', 'Confirmed fit', 'text'), field('package_quantity', 'Package quantity', 'number', { min: 1, max: 10000, step: 1 })],
    suggestedAccessories: []
  },
  {
    id: 'audio_data_cable', label: 'Audio / USB / MIDI / control cable', group: 'Cables & Routing', category: 'Cable',
    fields: [field('cable_purpose', 'Cable purpose', 'select', { options: ['Analog audio', 'Digital audio', 'USB data', 'MIDI', 'DSP/control', 'Trigger', 'Power', 'Network', 'Other'] }), field('connector_a', 'Connector A', 'text', { placeholder: 'e.g. USB-A male, XLR female' }), field('connector_b', 'Connector B', 'text', { placeholder: 'e.g. USB-B male, TRS 1/4 in' }), field('length', 'Length', 'text'), field('channel_count', 'Channel / pair count', 'number', { min: 1, max: 128, step: 1 }), field('balanced_shielded', 'Balanced / shielded', 'text'), field('usb_or_data_spec', 'USB / data standard', 'text', { placeholder: 'e.g. USB 2.0 active repeater, RS-485 proprietary' }), field('active_repeater', 'Active / repeater cable', 'boolean'), field('compatible_with', 'Compatible devices / protocol', 'text'), field('routing_from', 'Routed from', 'text'), field('routing_to', 'Routed to', 'text'), field('cable_label', 'Cable label / ID', 'text')],
    suggestedAccessories: [accessory('Cable labels'), accessory('Hook-and-loop cable ties')]
  },
  {
    id: 'patch_cable', label: 'Patch cable', group: 'Cables & Routing', category: 'Cable',
    fields: [field('signal_type', 'Signal type', 'select', { options: ['Balanced analog', 'Unbalanced analog', 'Stereo', 'Insert/Y cable', 'Digital', 'MIDI', 'Network', 'Other'] }), field('connector_a', 'Connector A', 'text'), field('connector_b', 'Connector B', 'text'), field('length', 'Length', 'text'), field('channel_count', 'Channel count', 'number', { min: 1, max: 128, step: 1 }), field('cable_label', 'Cable label / ID', 'text'), field('normal_routing', 'Normal routing / endpoints', 'textarea')],
    suggestedAccessories: [accessory('Cable labels'), accessory('Cable organizer')]
  },
  {
    id: 'patchbay', label: 'Audio patchbay', group: 'Cables & Routing', category: 'Patchbay',
    fields: [field('patch_format', 'Patch format', 'select', { options: ['1/4 in TRS', 'TT / bantam', 'XLR', 'RCA', 'Digital', 'Network', 'Other'] }), field('channel_count', 'Channel / point count', 'number', { min: 1, max: 512, step: 1 }), field('rack_units', 'Rack units', 'number', { min: 1, max: 12, step: 1 }), field('front_connectors', 'Front connectors', 'text'), field('rear_connectors', 'Rear connectors', 'text'), field('normalization', 'Normalization', 'select', { options: ['Configurable', 'Full-normal', 'Half-normal', 'Thru', 'Mixed / per channel'] }), field('balanced', 'Balanced connections', 'boolean'), field('routing_map', 'Normalled routing map', 'textarea'), field('labeling_scheme', 'Labeling scheme', 'text')],
    suggestedAccessories: [accessory('Patch cables', 'Cable', 'patch_cable', { repeatable: true }), accessory('Rack mounting screws', 'Fasteners / Small Hardware', 'fastener_hardware'), accessory('Cable labels'), accessory('Rear loom / snake', 'Cable', 'audio_data_cable', { optional: true })]
  },
  {
    id: 'equipment_rack', label: 'Equipment rack / rack case', group: 'Studio Infrastructure', category: 'Rack / Furniture',
    fields: [field('rack_units', 'Rack capacity (U)', 'number', { min: 1, max: 100, step: 1 }), field('rack_width', 'Rack standard / width', 'text', { placeholder: 'e.g. 19 in EIA' }), field('usable_depth', 'Usable depth', 'text'), field('rail_thread', 'Rail / cage-nut thread', 'text'), field('front_rear_rails', 'Front / rear rails', 'text'), field('load_rating', 'Load rating', 'text'), field('mobility', 'Mobility', 'select', { options: ['Fixed', 'Casters', 'Portable case', 'Desktop', 'Other'] }), field('power_distribution', 'Power distribution', 'text')],
    suggestedAccessories: [accessory('Rack screws / cage nuts', 'Fasteners / Small Hardware', 'fastener_hardware'), accessory('Rack shelf', 'Mounting Hardware', 'equipment_mount', { optional: true }), accessory('Cable management'), accessory('Power conditioner / PDU'), accessory('Patchbay', 'Patchbay', 'patchbay', { optional: true })]
  },
  {
    id: 'studio_monitor', label: 'Studio monitor speaker', group: 'Studio Monitoring', category: 'Speaker/Monitor',
    fields: [field('monitor_role', 'Monitor role', 'select', { options: ['Left', 'Right', 'Center', 'Surround', 'Subwoofer', 'Pair / set', 'Other'] }), field('active_passive', 'Amplification', 'select', { options: ['Active / powered', 'Passive', 'Network powered', 'Other'] }), field('driver_configuration', 'Driver configuration / sizes', 'text'), field('amplifier_power', 'Amplifier power', 'text'), field('frequency_response', 'Frequency response', 'text'), field('audio_inputs', 'Audio inputs', 'text'), field('dsp_features', 'DSP / room correction', 'textarea'), field('control_connection', 'DSP / control connection', 'text', { placeholder: 'e.g. proprietary serial cable, Ethernet, USB' }), field('pair_link', 'Speaker link / pairing cable', 'text'), field('firmware_version', 'Firmware version', 'text')],
    suggestedAccessories: [accessory('Audio input cable', 'Cable', 'audio_data_cable'), accessory('DSP / control serial cable', 'Cable', 'audio_data_cable', { specs: { cable_purpose: 'DSP/control' } }), accessory('Power cable'), accessory('Monitor stand / isolation pad', 'Mounting Hardware', 'equipment_mount'), accessory('Network cable', 'Cable', 'audio_data_cable', { optional: true })]
  },
  {
    id: 'instrument_accessory', label: 'General instrument accessory', group: 'Accessories', category: 'Instrument Accessory',
    fields: [field('accessory_type', 'Accessory type', 'text'), field('compatible_with', 'Confirmed compatible instrument / system', 'text'), field('incompatible_with', 'Known incompatibility', 'text'), field('compatibility_status', 'Compatibility result', 'select', { options: ['Confirmed compatible', 'Adapter required', 'Did not fit / incompatible', 'Untested', 'Modified to fit'] }), field('size_specification', 'Size / specification', 'text'), field('connector_type', 'Connector / mounting type', 'text'), field('material_finish', 'Material / finish', 'text')],
    suggestedAccessories: []
  }
];

const profileById = new Map(instrumentProfiles.map(profile => [profile.id, profile]));
const allFieldKeys = new Set(instrumentProfiles.flatMap(profile => profile.fields.map(entry => entry.key)));

function safeJsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function sanitizeInstrumentType(value) {
  const type = String(value || '').trim();
  return profileById.has(type) ? type : '';
}

function sanitizeInstrumentSpecs(instrumentType, value) {
  const profile = profileById.get(sanitizeInstrumentType(instrumentType));
  if (!profile) return {};
  const source = safeJsonObject(value);
  const out = {};
  for (const definition of profile.fields) {
    const raw = source[definition.key];
    if (raw == null || raw === '') continue;
    if (definition.type === 'boolean') {
      out[definition.key] = BOOLEAN_TRUE.has(raw);
    } else if (definition.type === 'number') {
      const number = Number(raw);
      if (!Number.isFinite(number)) continue;
      out[definition.key] = Math.min(definition.max ?? number, Math.max(definition.min ?? number, number));
    } else {
      const text = String(raw).trim().slice(0, definition.type === 'textarea' ? 3000 : 500);
      if (text) out[definition.key] = text;
    }
  }
  return out;
}

function instrumentDetails(instrumentType, specs) {
  const profile = profileById.get(sanitizeInstrumentType(instrumentType));
  if (!profile) return [];
  const clean = sanitizeInstrumentSpecs(profile.id, specs);
  return profile.fields
    .filter(definition => Object.prototype.hasOwnProperty.call(clean, definition.key))
    .map(definition => ({ key: definition.key, label: definition.label, value: clean[definition.key] }));
}

module.exports = {
  instrumentProfiles,
  profileById,
  allFieldKeys,
  sanitizeInstrumentType,
  sanitizeInstrumentSpecs,
  instrumentDetails
};
