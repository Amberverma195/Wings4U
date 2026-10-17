/** Curated flavours shown on Home until the full sauces catalogue is ready. */
export const SAUCES = [
  { name: 'Barbecue', emoji: '🔥', background: '#FBE4D5', ink: '#783716' },
  { name: 'Honey Garlic', emoji: '🍯', background: '#FFF0C9', ink: '#775015' },
  { name: 'Honey Barbecue', emoji: '🍯', background: '#F9DFCE', ink: '#79371F' },
  { name: 'Peanut Butter', emoji: '🥜', background: '#F2E3D0', ink: '#694323' },
  { name: 'Mild', emoji: '🌶️', background: '#FFE5D9', ink: '#8C3925' },
  { name: 'Buttery Buffalo', emoji: '🧈', background: '#FFE7BB', ink: '#814214' },
  { name: 'Fire and Ice', emoji: '🔥🧊', background: '#E0EDF5', ink: '#30516B' },
  { name: 'Honey Dill', emoji: '🌿', background: '#EEF0CE', ink: '#53612C' },
  { name: 'Garlic Parm', emoji: '🧄', background: '#F3EBD9', ink: '#645139' },
  { name: 'Creamy Cajun', emoji: '🌶️', background: '#F9DDCF', ink: '#823D2A' },
  { name: 'Whiskey Ranch', emoji: '🥃', background: '#EEE0D2', ink: '#694630' },
  { name: 'Texas Barbecue', emoji: '🤠', background: '#F3D9CB', ink: '#783D2B' },
  { name: 'Smoked Tequila Lime', emoji: '🍋‍🟩', background: '#E5EDCE', ink: '#4F6128' },
  { name: 'Spicy Dill', emoji: '🌿🌶️', background: '#DEECD7', ink: '#3E6338' },
  { name: 'Buffalo Ranch', emoji: '🌶️', background: '#FFE0D2', ink: '#863D2C' },
  { name: 'Spicy Lemon Ranch', emoji: '🍋', background: '#F9EEC5', ink: '#72601B' },
  { name: 'Nashville Hot', emoji: '🔥', background: '#F8D5D0', ink: '#922F2D' },
] as const;

export type Sauce = typeof SAUCES[number];
