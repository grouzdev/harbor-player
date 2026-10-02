import first from "../../assets/bg/1.jpg";
import second from "../../assets/bg/2.jpg";
import third from "../../assets/bg/3.jpg";
import fourth from "../../assets/bg/4.jpg";
import fifth from "../../assets/bg/5.jpg";

// Numbers match the bundled filenames; no separate names or preset manifest.
export const backgroundPresets = [first, second, third, fourth, fifth].map(
  (url, index) => ({ number: index + 1, url }),
);
