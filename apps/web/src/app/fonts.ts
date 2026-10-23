import {
  Bebas_Neue,
  Black_Han_Sans,
  DM_Sans,
  Libre_Baskerville,
  Oswald,
  Outfit,
  Poppins,
  Rajdhani,
} from "next/font/google";

export const bebasNeue = Bebas_Neue({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-bebas-neue",
});

export const blackHanSans = Black_Han_Sans({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-black-han-sans",
});

export const dmSans = DM_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-dm-sans",
});

export const libreBaskerville = Libre_Baskerville({
  weight: ["400", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-libre-baskerville",
});

export const oswald = Oswald({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-oswald",
});

export const outfit = Outfit({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-outfit",
});

export const poppins = Poppins({
  weight: ["500", "600", "700", "800"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-poppins",
});

export const rajdhani = Rajdhani({
  weight: ["500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-rajdhani",
});

export const fontVariables = [
  bebasNeue.variable,
  blackHanSans.variable,
  dmSans.variable,
  libreBaskerville.variable,
  oswald.variable,
  outfit.variable,
  poppins.variable,
  rajdhani.variable,
].join(" ");
