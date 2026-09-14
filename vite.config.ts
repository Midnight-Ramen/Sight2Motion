import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
    // Prebundle on the dev server to avoid a first-load page reload; browser imports remain lazy.
    include: ['@tensorflow/tfjs', '@teachablemachine/image'],
  },
  server: { port: 5174, strictPort: true },
});
