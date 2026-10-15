import type { ImageSource } from 'expo-image';
import type { MenuCategory } from './types';

const photos: Record<string, ImageSource> = {
  wings: require('../../assets/categories/wings.png'),
  'wing-combos': require('../../assets/categories/combos.png'),
  'lunch-specials': require('../../assets/categories/combos.png'),
  burgers: require('../../assets/categories/burgers.png'),
  tenders: require('../../assets/categories/tenders.png'),
  wraps: require('../../assets/categories/wraps.png'),
  salads: require('../../assets/categories/salads.png'),
  'poutines-and-sides': require('../../assets/categories/sides.png'),
  sides: require('../../assets/categories/sides.png'),
  'specialty-fries': require('../../assets/categories/sides.png'),
  appetizers: require('../../assets/categories/appetizers.png'),
  'appetizers-extras': require('../../assets/categories/appetizers.png'),
  breads: require('../../assets/categories/breads.png'),
  specials: require('../../assets/categories/combos.png'),
  'party-specials': require('../../assets/categories/combos.png'),
  drinks: require('../../assets/categories/drinks.png'),
  dessert: require('../../assets/categories/dessert.png'),
  dips: require('../../assets/categories/sauces.png'),
  sauces: require('../../assets/categories/sauces.png'),
};

const shortLabels: Record<string, string> = {
  'wing-combos': 'Combos', 'lunch-specials': 'Lunch',
  'poutines-and-sides': 'Sides', 'specialty-fries': 'Fries',
  'appetizers-extras': 'Extras', 'party-specials': 'Party',
  dips: 'Sauces',
};

export function categoryImage(category: MenuCategory): ImageSource {
  const photo = photos[category.slug];
  if (photo) return photo;
  const menuPhoto = category.items.find(item => item.image_url)?.image_url;
  return menuPhoto ? { uri: menuPhoto } : photos['wing-combos'];
}

export function categoryLabel(category: MenuCategory): string {
  return shortLabels[category.slug] ?? category.name;
}
