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
  expect(address.replaceSavedAddressByIdSync.mock.calls[0][0]).toBe('existing');
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

const propsFor = overrides => ({open:true,addressOnly:true,onClose:jest.fn(),onContinue:jest.fn(),...overrides});
const mountEditor = async props => act(async()=>{renderer=create(React.createElement(OrderMethodModal,props));});
const submit = () => renderer.root.findByProps({className:'wk-method-continue'}).props.onClick();
const fillAddress = async () => act(async()=>{
  const inputs=renderer.root.findAllByType('input');
  inputs.find(node=>node.props.autoComplete==='address-line1').props.onChange({target:{value:'12 Main St'}});
  inputs.find(node=>node.props.autoComplete==='postal-code').props.onChange({target:{value:'N5Y 4J7'}});
});
test.each(['account','order'])('%s Add is blank create mode; order entries offer unchecked consent',async context=>{
  await mountEditor(propsFor({addressContext:context}));
  expect(renderer.root.findByProps({role:'dialog'}).props['aria-label']).toBe('ADD DELIVERY ADDRESS');
  expect(renderer.root.findAllByType('input').find(node=>node.props.autoComplete==='address-line1').props.value).toBe('');
  const checkboxes=renderer.root.findAllByProps({type:'checkbox'});
  expect(checkboxes).toHaveLength(context==='order'?1:0);
  if(context==='order') expect(checkboxes[0].props.checked).toBe(false);
  expect(JSON.stringify(renderer.toJSON())).toContain(context==='account'?'ADD ADDRESS':'USE ADDRESS');
});
test('unchecked order address selects checkout draft without saved API or saved toast',async()=>{
  global.window=new EventTarget();const saved=jest.fn();window.addEventListener('saved-address',saved);
  const props=propsFor({});await mountEditor(props);await fillAddress();await act(async()=>submit());
  expect(address.upsertSavedAddressFromDraft).not.toHaveBeenCalled();
  expect(address.saveDeliveryAddressDraft).toHaveBeenCalledWith({line1:'12 Main St',city:'London',postalCode:'N5Y 4J7'},false);
  expect(props.onContinue).toHaveBeenCalledTimes(1);expect(saved).not.toHaveBeenCalled();
});
test('checked order entry saves once and selects it; only confirmed persistence shows saved toast',async()=>{
  global.window=new EventTarget();const saved=jest.fn();window.addEventListener('saved-address',saved);
  address.upsertSavedAddressFromDraft.mockResolvedValueOnce(true);
  await mountEditor(propsFor({}));await fillAddress();
  await act(async()=>renderer.root.findByProps({type:'checkbox'}).props.onChange({target:{checked:true}}));
  expect(JSON.stringify(renderer.toJSON())).toContain('SAVE & USE ADDRESS');
  await act(async()=>submit());expect(address.upsertSavedAddressFromDraft).toHaveBeenCalledTimes(1);expect(saved).toHaveBeenCalledTimes(1);
});
test('switching Edit to Add clears fields and consent; reopen does not retain opt-in',async()=>{
  const props=propsFor({editingSavedAddressId:'existing'});await mountEditor(props);
  expect(renderer.root.findByProps({role:'dialog'}).props['aria-label']).toBe('UPDATE DELIVERY ADDRESS');
  expect(renderer.root.findAllByType('input')[0].props.value).toBe('20 King Street');
  await act(async()=>renderer.update(React.createElement(OrderMethodModal,{...props,editingSavedAddressId:null})));
  expect(renderer.root.findAllByType('input')[0].props.value).toBe('');
  await act(async()=>renderer.root.findByProps({type:'checkbox'}).props.onChange({target:{checked:true}}));
  await act(async()=>renderer.update(React.createElement(OrderMethodModal,{...props,open:false,editingSavedAddressId:null})));
  await act(async()=>renderer.update(React.createElement(OrderMethodModal,{...props,editingSavedAddressId:null})));
  expect(renderer.root.findByProps({type:'checkbox'}).props.checked).toBe(false);
});
test('account Add persists explicitly and never changes the current order draft',async()=>{
  address.upsertSavedAddressFromDraft.mockResolvedValueOnce(true);
  await mountEditor(propsFor({addressContext:'account'}));await fillAddress();await act(async()=>submit());
  expect(address.upsertSavedAddressFromDraft).toHaveBeenCalledTimes(1);expect(address.saveDeliveryAddressDraft).not.toHaveBeenCalled();
});

test('initial delivery setup keeps its delivery heading and menu action',async()=>{
  await mountEditor(propsFor({addressOnly:false,initialStep:'address'}));
  expect(renderer.root.findByProps({role:'dialog'}).props['aria-label']).toBe('WHERE SHOULD WE DELIVER?');
  expect(JSON.stringify(renderer.toJSON())).toContain('CONTINUE TO MENU');
  expect(renderer.root.findByProps({type:'checkbox'}).props.checked).toBe(false);
});
test('guest opt-in defers saving feedback until authentication',async()=>{
  global.window=new EventTarget();const saved=jest.fn();window.addEventListener('saved-address',saved);
  address.upsertSavedAddressFromDraft.mockResolvedValueOnce(false);
  await mountEditor(propsFor({}));await fillAddress();
  await act(async()=>renderer.root.findByProps({type:'checkbox'}).props.onChange({target:{checked:true}}));
  await act(async()=>submit());expect(address.upsertSavedAddressFromDraft).toHaveBeenCalledTimes(1);expect(saved).not.toHaveBeenCalled();
});
