const React=require('react');
const {act,create}=require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT=true;
jest.mock('@/lib/api',()=>({apiJson:jest.fn()}));
jest.mock('@/lib/env',()=>({DEFAULT_LOCATION_ID:'location'}));
jest.mock('@/lib/delivery-address',()=>({
  FIXED_DELIVERY_CITY:'London',DELIVERY_ADDRESS_SAVED_EVENT:'saved-address',
  loadSavedAddresses:()=>[{id:'existing',line1:'20 King Street',city:'London',postalCode:'N5Y 4J7'}],
  loadDeliveryAddressDraft:()=>null,normalizeDeliveryPostalCode:value=>value,
  replaceSavedAddressById:jest.fn(),replaceSavedAddressByIdSync:jest.fn(),
  upsertSavedAddressFromDraft:jest.fn(),upsertSavedAddressFromDraftSync:jest.fn(),saveDeliveryAddressDraft:jest.fn(),
}));
const address=require('@/lib/delivery-address');
const {OrderMethodModal}=require('../src/Wings4u/components/order-method-modal');
let renderer;
beforeEach(()=>jest.clearAllMocks());
afterEach(async()=>{if(renderer) await act(async()=>renderer.unmount());renderer=null;delete global.window;});
test('editor prevents repeated submissions, shows duplicate errors and only commits the draft after server success',async()=>{
  global.window=new EventTarget();
  const onContinue=jest.fn();
  let reject;
  address.replaceSavedAddressByIdSync.mockReturnValueOnce(new Promise((_,fail)=>{reject=fail;}));
  await act(async()=>{renderer=create(React.createElement(OrderMethodModal,{open:true,addressOnly:true,editingSavedAddressId:'existing',onClose:jest.fn(),onContinue,refresh:jest.fn(),clear:jest.fn()}));});
  const button=()=>renderer.root.findByProps({className:'wk-method-continue'});
  let first;
  await act(async()=>{first=button().props.onClick();});
  expect(button().props.disabled).toBe(true);
  await act(async()=>{await button().props.onClick();});
  expect(address.replaceSavedAddressByIdSync).toHaveBeenCalledTimes(1);
  await act(async()=>{reject(new Error('This address is already saved.'));await first;});
  expect(JSON.stringify(renderer.toJSON())).toContain('This address is already saved.');
  expect(onContinue).not.toHaveBeenCalled();expect(address.saveDeliveryAddressDraft).not.toHaveBeenCalled();
  address.replaceSavedAddressByIdSync.mockResolvedValueOnce(undefined);
  await act(async()=>{await button().props.onClick();});
  expect(onContinue).toHaveBeenCalledTimes(1);expect(address.saveDeliveryAddressDraft).toHaveBeenCalledTimes(1);
});
test('a save completed after closing the editor cannot commit an obsolete checkout draft',async()=>{
  global.window=new EventTarget();
  const onContinue=jest.fn();let complete;
  address.replaceSavedAddressByIdSync.mockReturnValueOnce(new Promise(resolve=>{complete=resolve;}));
  const props={open:true,addressOnly:true,editingSavedAddressId:'existing',onClose:jest.fn(),onContinue,refresh:jest.fn(),clear:jest.fn()};
  await act(async()=>{renderer=create(React.createElement(OrderMethodModal,props));});
  let request;await act(async()=>{request=renderer.root.findByProps({className:'wk-method-continue'}).props.onClick();});
  await act(async()=>{renderer.update(React.createElement(OrderMethodModal,{...props,open:false}));});
  await act(async()=>{complete();await request;});
  expect(onContinue).not.toHaveBeenCalled();expect(address.saveDeliveryAddressDraft).not.toHaveBeenCalled();
});
