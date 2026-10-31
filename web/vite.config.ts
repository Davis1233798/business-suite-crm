import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
export default defineConfig({root:fileURLToPath(new URL('.',import.meta.url)),publicDir:'../public',plugins:[react()],build:{outDir:'../web-dist',emptyOutDir:true},server:{host:'127.0.0.1',port:5175,proxy:{'/api':'http://127.0.0.1:8095'}}});
