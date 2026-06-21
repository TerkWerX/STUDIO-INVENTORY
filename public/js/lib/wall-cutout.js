/** Wall cutout helpers — inventory-stored cutout vs placement on studio map. */

export function effectiveWallCutout(item) {
  const mp = item?.map_placement;
  if (mp?.wall_photo_path && mp?.icon_mode === 'photo') {
    return {
      source: 'placement',
      wall_photo_path: mp.wall_photo_path,
      photo_width_ft: mp.photo_width_ft,
      photo_height_ft: mp.photo_height_ft,
      photo_calibration: mp.photo_calibration
    };
  }
  const wc = item?.wall_cutout;
  if (wc?.path) {
    return {
      source: 'inventory',
      wall_photo_path: wc.path,
      photo_width_ft: wc.width_ft,
      photo_height_ft: wc.height_ft,
      photo_calibration: wc.calibration
    };
  }
  return null;
}

export function cutoutToPin(cutout) {
  if (!cutout) return null;
  return {
    icon_mode: 'photo',
    wall_photo_path: cutout.wall_photo_path,
    photo_width_ft: cutout.photo_width_ft,
    photo_height_ft: cutout.photo_height_ft,
    photo_calibration: cutout.photo_calibration
  };
}

export function cutoutPinForEditor(item) {
  const cutout = effectiveWallCutout(item);
  if (cutout) return cutoutToPin(cutout);
  return { icon_mode: 'logo', wall_photo_path: '' };
}

export function pendingItemCutoutFields(item) {
  const wc = item?.wall_cutout;
  if (!wc?.path) return null;
  return {
    icon_mode: 'photo',
    wall_photo_path: wc.path,
    photo_width_ft: wc.width_ft,
    photo_height_ft: wc.height_ft,
    photo_calibration: wc.calibration
  };
}