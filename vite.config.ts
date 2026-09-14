import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      output: {
        // ONNX launches its proxy worker from its own module URL. Keep the React app out of that module.
        manualChunks: id => /node_modules[\\/]onnxruntime-(web|common)[\\/]/.test(id) ? 'onnxruntime' : undefined,
      },
    },
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
    // Prebundle on the dev server to avoid a first-load page reload; browser imports remain lazy.
    include: ['@tensorflow/tfjs', '@teachablemachine/image'],
  },
  server: { port: 5174, strictPort: true },
});
