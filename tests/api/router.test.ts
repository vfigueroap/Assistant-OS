import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handle } from '../../apps/api/src/router.js';

function exchange(path:string,method='GET',headers:Record<string,string>={}){
  const req={url:path,method,headers} as Parameters<typeof handle>[0];
  let body='';let status=200;const sentHeaders:Record<string,string>={};
  const res={set statusCode(value:number){status=value},get statusCode(){return status},setHeader(name:string,value:string){sentHeaders[name]=value},end(value:string){body=value}} as unknown as Parameters<typeof handle>[1];
  return handle(req,res).then(()=>({status,body:JSON.parse(body),headers:sentHeaders}));
}

describe('public API boundary',()=>{
  const previous={url:process.env.SUPABASE_URL,key:process.env.SUPABASE_PUBLISHABLE_KEY};
  beforeEach(()=>{process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_test'});
  afterEach(()=>{if(previous.url===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=previous.url;if(previous.key===undefined)delete process.env.SUPABASE_PUBLISHABLE_KEY;else process.env.SUPABASE_PUBLISHABLE_KEY=previous.key});
  it('serves only public Supabase configuration without cache',async()=>{
    const result=await exchange('/api/config');
    expect(result.status).toBe(200);
    expect(result.body).toEqual({supabaseUrl:'https://test.supabase.co',supabasePublishableKey:'sb_publishable_test'});
    expect(result.headers['cache-control']).toBe('private, no-store');
    expect(JSON.stringify(result.body)).not.toContain('SECRET');
  });
  it('blocks gym state and snapshot endpoints before database access without a session',async()=>{
    for(const path of ['/gym/api/data','/gym/api/data/rev','/gym/api/snapshots']){
      const result=await exchange(path,path.endsWith('snapshots')?'POST':'GET');
      expect(result.status).toBe(401);
    }
  });
  it('does not expose arbitrary API paths',async()=>{
    expect((await exchange('/api/private')).status).toBe(404);
  });
});
