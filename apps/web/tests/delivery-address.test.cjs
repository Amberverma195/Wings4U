jest.mock('@/lib/api',()=>({apiFetch:jest.fn()}));
jest.mock('@/lib/session',()=>({withSilentRefresh:jest.fn(callback=>callback())}));
const { randomUUID }=require('node:crypto');
const draft={line1:'629 B Huron St unit 111',city:'London',postalCode:'N5Y4J7'};
let addresses,apiFetch,serverRows;
const response=(data,status=200)=>({ok:status<400,status,json:async()=>({data,errors:status>=400?[{message:'This address is already saved.'}]:[]})});
beforeEach(()=>{
  jest.resetModules();
  const data=new Map(); global.window=Object.assign(new EventTarget(),{sessionStorage:{getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)}});
  global.crypto??={randomUUID};
  addresses=require('../src/lib/delivery-address'); apiFetch=require('@/lib/api').apiFetch; serverRows=[];
  apiFetch.mockImplementation(async(path,options={})=>{
    if(!options.method) return response({items:serverRows});
    const body=JSON.parse(options.body);
    const row={id:'real-database-id',line1:body.line1,city:body.city,postal_code:body.postal_code,is_default:false,label:null};
    serverRows=[row]; return response(row);
  });
});
afterEach(()=>{delete global.window;});

test.each(['N5Y4J7','n5y4j7','N5Y 4J7',' n5y   4j7 '])('canonical postal format for %s',postal=>{
  expect(addresses.normalizeDeliveryPostalCode(postal)).toBe('N5Y 4J7');
});
test('guest saves and picker comparisons include normalized street, city, postal and unit',async()=>{
  await addresses.upsertSavedAddressFromDraft(draft);
  const first=addresses.loadSavedAddresses()[0];
  await addresses.upsertSavedAddressFromDraft({...draft,line1:' 629   b HURON St unit 111 ',city:' london ',postalCode:'n5y 4j7'});
  expect(addresses.loadSavedAddresses()).toHaveLength(1);
  expect(addresses.loadSavedAddresses()[0].id).toBe(first.id);
  await addresses.upsertSavedAddressFromDraft({...draft,line1:'629 B Huron St unit 112'});
  await addresses.upsertSavedAddressFromDraft({...draft,city:'Toronto'});
  expect(addresses.loadSavedAddresses()).toHaveLength(3);
});
test('guest login migration is coalesced and replaces the temporary ID with the real ID',async()=>{
  addresses.saveDeliveryAddressDraft(draft); await addresses.upsertSavedAddressFromDraft(draft);
  addresses.setDeliveryAddressAuthState(true,'customer');
  expect(await Promise.all([addresses.persistPendingGuestDeliveryAddress(),addresses.persistPendingGuestDeliveryAddress()])).toEqual([true,true]);
  expect(apiFetch.mock.calls.filter(([path])=>path.endsWith('/ensure'))).toHaveLength(1);
  expect(addresses.loadSavedAddresses()).toEqual([{id:'real-database-id',...draft,postalCode:'N5Y 4J7'}]);
  expect(await addresses.persistPendingGuestDeliveryAddress()).toBe(false);
});
test('repeated signed-in saves persist canonical data and retain one authoritative ID after refresh',async()=>{
  addresses.setDeliveryAddressAuthState(true,'customer');
  await addresses.upsertSavedAddressFromDraft(draft);
  await addresses.upsertSavedAddressFromDraft({...draft,postalCode:'n5y 4j7'});
  await addresses.syncSavedAddressesFromServer();
  expect(addresses.loadSavedAddresses()).toHaveLength(1);
  expect(addresses.loadSavedAddresses()[0].id).toBe('real-database-id');
  expect(JSON.parse(apiFetch.mock.calls.find(([,options])=>options?.method==='POST')[1].body).postal_code).toBe('N5Y 4J7');
});
test('a duplicate edit surfaces the error and preserves the original cache and checkout draft',async()=>{
  addresses.setDeliveryAddressAuthState(true,'customer'); await addresses.upsertSavedAddressFromDraft(draft);
  addresses.saveDeliveryAddressDraft(draft); const before=addresses.loadSavedAddresses();
  apiFetch.mockResolvedValue(response(null,409));
  await expect(addresses.replaceSavedAddressById('real-database-id',{...draft,line1:'Other address'})).rejects.toThrow('This address is already saved.');
  expect(addresses.loadSavedAddresses()).toEqual(before);
  expect(addresses.loadDeliveryAddressDraft().line1).toBe(draft.line1);
});
test('successful edit refreshes the saved list using the same database ID',async()=>{
  addresses.setDeliveryAddressAuthState(true,'customer'); await addresses.upsertSavedAddressFromDraft(draft);
  await addresses.replaceSavedAddressById('real-database-id',{...draft,line1:'20 King Street'});
  expect(addresses.loadSavedAddresses()).toEqual([{id:'real-database-id',...draft,line1:'20 King Street',postalCode:'N5Y 4J7'}]);
});
test('guest duplicate edits are rejected without silently deleting either row',async()=>{
  await addresses.upsertSavedAddressFromDraft(draft); await addresses.upsertSavedAddressFromDraft({...draft,line1:'20 King Street'});
  const before=addresses.loadSavedAddresses();
  await expect(addresses.replaceSavedAddressById(before[1].id,draft)).rejects.toThrow('already saved');
  expect(addresses.loadSavedAddresses()).toEqual(before);
});
test('removing a guest address does not resurrect it from the active draft',async()=>{
  addresses.saveDeliveryAddressDraft(draft); await addresses.upsertSavedAddressFromDraft(draft);
  addresses.removeSavedAddressById(addresses.loadSavedAddresses()[0].id);
  expect(addresses.loadSavedAddresses()).toEqual([]); expect(addresses.loadDeliveryAddressDraft()).toBeNull();
});
test('late address responses cannot populate another customer session',async()=>{
  addresses.setDeliveryAddressAuthState(true,'customer');
  let complete; apiFetch.mockReturnValue(new Promise(resolve=>{complete=resolve;}));
  const request=addresses.syncSavedAddressesFromServer();
  addresses.setDeliveryAddressAuthState(true,'other-customer');
  complete(response({items:[{id:'private-id',line1:'Private',city:'London',postal_code:'N5Y4J7'}]})); await request;
  expect(addresses.loadSavedAddresses()).toEqual([]);
});
test('a stale refresh cannot overwrite a newly confirmed saved address',async()=>{
  addresses.setDeliveryAddressAuthState(true,'customer');
  let complete; apiFetch.mockReturnValueOnce(new Promise(resolve=>{complete=resolve;}));
  const stale=addresses.syncSavedAddressesFromServer();
  await addresses.upsertSavedAddressFromDraft(draft);
  complete(response({items:[]}));await stale;
  expect(addresses.loadSavedAddresses()[0].id).toBe('real-database-id');
});
