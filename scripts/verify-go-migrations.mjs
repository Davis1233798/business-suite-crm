import {readdirSync,readFileSync} from 'node:fs';
for(const file of readdirSync('drizzle').filter(x=>x.endsWith('.sql'))){
 if(!readFileSync('drizzle/'+file).equals(readFileSync('backend/migrations/'+file)))throw new Error('Go migration differs from source: '+file);
}
console.log('Go / existing SQLite migrations match');
