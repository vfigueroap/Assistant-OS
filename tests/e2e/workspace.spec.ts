import { expect, test, type Page } from '@playwright/test';

const cloudOrigin='https://workspace.example.org';
const ownerId='11111111-1111-4111-8111-111111111111';

async function workspace(page:Page, signedIn=true){
  const user={id:ownerId,aud:'authenticated',role:'authenticated',email:'owner@example.org',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
  const expiresAt=Math.floor(Date.now()/1000)+3600;
  const payload=Buffer.from(JSON.stringify({sub:ownerId,aud:'authenticated',role:'authenticated',exp:expiresAt})).toString('base64url');
  if(signedIn)await page.addInitScript(session=>localStorage.setItem('assistant-os-auth',JSON.stringify(session)),{access_token:`eyJhbGciOiJIUzI1NiJ9.${payload}.fixture`,refresh_token:'fixture',token_type:'bearer',expires_in:3600,expires_at:expiresAt,user});
  const tables:Record<string,Array<Record<string,any>>>={records:[],transactions:[],documents:[],financial_evidence:[],jobs:[],actions:[],fragments:[],budgets:[],schedules:[]};
  const state={tables,rpcs:[] as Array<{name:string;data:Record<string,any>}>,uploads:[] as string[],unexpected:[] as string[],errors:[] as string[],paused:true};
  page.on('pageerror',error=>state.errors.push(error.message));
  await page.route('**/*',async route=>{
    const request=route.request();const url=new URL(request.url());
    if(url.origin==='http://127.0.0.1:5173'){
      if(url.pathname==='/api/config')return route.fulfill({json:{configured:true,supabaseUrl:cloudOrigin,supabasePublishableKey:'sb_publishable_workspace_fixture'}});
      return route.continue();
    }
    if(url.origin!==cloudOrigin){state.unexpected.push(request.url());return route.abort()}
    if(url.pathname==='/auth/v1/user')return route.fulfill(signedIn?{json:user}:{status:401,json:{message:'No session'}});
    if(url.pathname.startsWith('/storage/v1/object/personal-files/')&&request.method()==='POST'){state.uploads.push(url.pathname);return route.fulfill({json:{Key:url.pathname}})}
    const rpc=/^\/rest\/v1\/rpc\/(.+)$/.exec(url.pathname);
    if(rpc){
      const name=rpc[1];const data=request.postDataJSON()??{};state.rpcs.push({name,data});
      if(name==='get_dashboard')return route.fulfill({json:{generated_at:new Date().toISOString(),recent:[],current:[],upcoming:[],snapshots:[]}});
      if(name==='is_workspace_owner')return route.fulfill({json:true});
      if(name==='get_workspace_settings')return route.fulfill({json:{paused:state.paused}});
      if(name==='ui_worker_status')return route.fulfill({json:{online:false,last_seen_at:null}});
      if(name==='set_execution_paused')state.paused=data.p_paused;
      if(name==='approve_action'){const action=tables.actions.find(row=>row.id===data.p_id);if(action)action.status='approved'}
      if(name==='enqueue_job')tables.jobs.unshift({id:crypto.randomUUID(),owner_id:ownerId,kind:data.p_kind,status:'queued',created_at:new Date().toISOString()});
      if(name==='confirm_financial_draft'){const row=tables.transactions.find(item=>item.id===data.p_transaction_id);if(row)Object.assign(row,{status:'confirmed',amount_minor:data.p_amount_minor,merchant:data.p_merchant,occurred_at:data.p_occurred_at})}
      return route.fulfill({json:{ok:true,status:'confirmed'}});
    }
    const table=/^\/rest\/v1\/([^/]+)$/.exec(url.pathname);
    if(table){
      const name=table[1];if(name==='gym_profiles')return route.fulfill({json:{workout_count:0}});
      if(!(name in tables)){state.unexpected.push(url.pathname);return route.abort()}
      if(request.method()==='GET')return route.fulfill({json:tables[name].filter(row=>url.searchParams.get('deleted_at')!=='is.null'||!row.deleted_at)});
      if(request.method()==='POST'){tables[name].unshift({id:crypto.randomUUID(),owner_id:ownerId,created_at:new Date().toISOString(),...request.postDataJSON()});return route.fulfill({status:201,json:tables[name][0]})}
      if(request.method()==='PATCH'){for(const row of tables[name])if(!url.searchParams.has('id')||url.searchParams.get('id')===`eq.${row.id}`)Object.assign(row,request.postDataJSON());return route.fulfill({json:tables[name]})}
    }
    state.unexpected.push(`${request.method()} ${url.pathname}`);return route.abort();
  });
  return state;
}

test('las nueve áreas comparten acceso y conservan las herramientas y rutas legadas',async({page})=>{
  const state=await workspace(page);
  await page.goto('/study');
  await expect(page.getByRole('heading',{name:'Educación',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Estudios',exact:true})).toBeVisible();
  for(const width of [320,1440]){
    await page.setViewportSize({width,height:1000});
    for(const theme of ['light','dark']){
      await page.screenshot({path:`.local/workspace-study-${width}-${theme}.png`,fullPage:true});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.getByRole('button',{name:/^Tema /}).click();
    }
  }
  await page.setViewportSize({width:1280,height:900});
  for(const label of ['Trabajo','Salud','Espiritualidad','Pareja','Familia y amigos','Cinco baldes','Sistema','Negocios','Educación']){
    await page.getByRole('button',{name:'Abrir áreas',exact:true}).click();
    const navigation=page.getByRole('navigation',{name:'Áreas principales',exact:true});
    await expect(navigation.getByRole('link')).toHaveCount(10);
    await navigation.getByRole('link',{name:label,exact:true}).click();
    await expect(page.getByRole('heading',{name:label,exact:true,level:1})).toBeVisible();
    await expect(page.getByRole('navigation',{name:`Apartados de ${label}`,exact:true})).toBeVisible();
  }
  const routes=[['/study','Estudios'],['/calendar','Próximos en Salud'],['/finance','Finanzas'],['/goals','Objetivos'],['/knowledge','Notas'],['/projects','Proyectos'],['/system','Control de agentes']];
  for(const[path,heading]of routes){await page.goto(path);await expect(page.getByRole('heading',{name:heading,exact:true})).toBeVisible()}
  await page.goto('/calendar');
  await expect(page.getByRole('link',{name:'Abrir Google Calendar',exact:true})).toHaveAttribute('href','https://calendar.google.com/calendar/u/0/r');
  await page.setViewportSize({width:320,height:900});
  await page.getByRole('button',{name:'Abrir áreas',exact:true}).click();
  await expect(page.getByRole('button',{name:'Cerrar áreas',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:'Abrir áreas',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'Abrir áreas',exact:true}).click();
  await page.getByRole('navigation',{name:'Herramientas personales',exact:true}).getByRole('link',{name:'Mis registros',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Lo que quieres hacer y recordar'})).toBeVisible();
  expect(state.rpcs.some(call=>call.name==='get_dashboard'&&call.data.p_area==='education')).toBe(true);
  expect(state.errors).toEqual([]);expect(state.unexpected).toEqual([]);
});

test('las áreas privadas conservan el acceso compartido del portal',async({page})=>{
  const state=await workspace(page,false);
  await page.goto('/areas/education/studies');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fareas%2Feducation%2Fstudies$/);
  expect(state.rpcs).toEqual([]);
  expect(state.errors).toEqual([]);expect(state.unexpected).toEqual([]);
});

test('crear registros y subir material siguen usando los contratos existentes',async({page})=>{
  const state=await workspace(page);
  await page.goto('/study');
  await page.getByRole('button',{name:'Nuevo curso',exact:true}).click();
  await page.getByLabel('Título',{exact:true}).fill('Álgebra');
  await page.getByRole('button',{name:'Guardar',exact:true}).click();
  await expect(page.getByText('Álgebra',{exact:true})).toBeVisible();
  expect(state.tables.records[0].kind).toBe('course');
  await page.locator('input[type=file]').setInputFiles({name:'clase.txt',mimeType:'text/plain',buffer:Buffer.from('Apunte de prueba')});
  await expect(page.getByText('clase.txt',{exact:true})).toBeVisible();
  expect(state.uploads).toHaveLength(1);
  expect(state.rpcs.some(call=>call.name==='enqueue_job'&&call.data.p_kind==='document.extract')).toBe(true);
  await page.goto('/projects');
  await page.getByRole('button',{name:'Nuevo proyecto',exact:true}).click();
  await page.getByLabel('Título',{exact:true}).fill('Proyecto conservado');
  await page.getByRole('button',{name:'Guardar',exact:true}).click();
  await page.getByRole('button',{name:'Marcar como hecho Proyecto conservado',exact:true}).click();
  await expect(page.getByText('Proyecto conservado',{exact:true})).toHaveCount(0);
  expect(state.tables.records.find(row=>row.title==='Proyecto conservado')?.status).toBe('completed');
  expect(state.errors).toEqual([]);expect(state.unexpected).toEqual([]);
});

test('finanzas, trabajos y programación conservan sus acciones sin servicios reales',async({page})=>{
  const state=await workspace(page);
  state.tables.transactions.push({id:crypto.randomUUID(),owner_id:ownerId,amount_minor:1000,currency:'CLP',direction:'expense',kind:'purchase',status:'draft',settlement_status:'unknown',merchant:'Librería',description:'Boleta',category:null,occurred_at:'2026-11-16T12:00:00Z',evidence_id:null});
  await page.goto('/finance');
  await page.getByRole('button',{name:'Revisar',exact:true}).click();
  await page.getByRole('button',{name:'Confirmar',exact:true}).click();
  await expect(page.getByRole('button',{name:'Revisar',exact:true})).toHaveCount(0);
  expect(state.rpcs.some(call=>call.name==='confirm_financial_draft')).toBe(true);
  await page.getByRole('button',{name:'Nuevo presupuesto',exact:true}).click();
  await page.getByPlaceholder('Nombre',{exact:true}).fill('Materiales');
  await page.getByPlaceholder('Límite',{exact:true}).fill('10.000');
  await page.getByRole('button',{name:'Guardar',exact:true}).click();
  await expect(page.getByText('Materiales',{exact:true})).toBeVisible();
  expect(state.tables.budgets[0].amount_minor).toBe(10000);
  await page.goto('/system');
  await page.getByRole('button',{name:'Reanudar agentes',exact:true}).click();
  await expect(page.getByRole('button',{name:'Pausar agentes',exact:true})).toBeVisible();
  await page.getByPlaceholder('ID de conexión, por ejemplo personal').fill('personal');
  await page.getByRole('button',{name:'Sincronizar',exact:true}).click();
  expect(state.rpcs.some(call=>call.name==='enqueue_job'&&call.data.p_kind==='calendar.sync')).toBe(true);
  await page.getByRole('button',{name:'Programar calendario',exact:true}).click();
  await expect(page.getByText('Calendario personal',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Pausar',exact:true}).click();
  await expect(page.getByRole('button',{name:'Activar',exact:true})).toBeVisible();
  expect(state.tables.schedules[0].enabled).toBe(false);
  expect(state.errors).toEqual([]);expect(state.unexpected).toEqual([]);
});
