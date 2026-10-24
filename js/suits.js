// Shared SVG shapes; deck data contains only shape names.
const shapes = {
  "circle": "<circle cx=\"12\" cy=\"12\" r=\"6.5\"/>",
  "rings": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\"><circle cx=\"9\" cy=\"12\" r=\"5.5\"/><circle cx=\"15\" cy=\"12\" r=\"5.5\"/></g>",
  "diamond": "<path d=\"M12 2.5 20.5 12 12 21.5 3.5 12z\"/>",
  "house": "<path d=\"M12 3 21 10.5V21H3V10.5z\"/>",
  "heart": "<path d=\"M12 21s-8.5-5.4-8.5-11.3A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 8.5 2.7C20.5 15.6 12 21 12 21z\"/>",
  "ring": "<circle cx=\"12\" cy=\"12\" r=\"7\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"3\"/>",
  "moon": "<path d=\"M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z\"/>",
  "spark": "<path d=\"M12 2l2.1 7.9L22 12l-7.9 2.1L12 22l-2.1-7.9L2 12l7.9-2.1z\"/>",
  "hexagon": "<path d=\"M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z\"/>",
  "square": "<rect x=\"5\" y=\"5\" width=\"14\" height=\"14\" rx=\"1.5\"/>",
  "mountains": "<path d=\"M2 20 9 7l4.2 7.6L15.5 11 22 20z\"/>"
};
export const suit = name => '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' + (shapes[name] || shapes.circle) + '</svg>';
