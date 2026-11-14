import { createServer } from 'node:http';
import { handle } from './src/router.js';
try{process.loadEnvFile('.env.local')}catch{}
createServer((req,res)=>void handle(req,res)).listen(8787,'127.0.0.1',()=>console.log('Assistant OS API at http://127.0.0.1:8787'));
