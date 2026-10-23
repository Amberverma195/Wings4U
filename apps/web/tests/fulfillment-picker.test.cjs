const React = require('react');
const { act, create } = require('react-test-renderer');
const { FulfillmentPicker } = require('../src/components/fulfillment-picker');
global.IS_REACT_ACT_ENVIRONMENT = true;
let renderer;
afterEach(async()=>{if(renderer)await act(async()=>renderer.unmount());renderer=null;});

test('fulfillment choices expose radio semantics and one selected tab stop', async()=>{
  const onChange=jest.fn();
  const render=value=>React.createElement(FulfillmentPicker,{value,onChange,deliveryUnavailable:false});
  await act(async()=>{renderer=create(render('PICKUP'));});
  const group=renderer.root.findByProps({role:'radiogroup'});
  expect(group.props['aria-label']).toBe('Edit fulfillment type');
  let radios=renderer.root.findAllByProps({role:'radio'});
  expect(radios.map(r=>r.props.tabIndex)).toEqual([0,-1]);
  const domGroup={};
  const buttons=radios.map(r=>({disabled:false,getAttribute:()=>null,closest:()=>domGroup,focus:jest.fn(),click:r.props.onClick}));
  domGroup.querySelectorAll=()=>buttons;
  group.props.onKeyDown({key:'ArrowRight',target:buttons[0],currentTarget:domGroup,preventDefault:jest.fn()});
  expect(buttons[1].focus).toHaveBeenCalled();
  expect(onChange).toHaveBeenCalledWith('DELIVERY');
  await act(async()=>renderer.update(render('DELIVERY')));
  radios=renderer.root.findAllByProps({role:'radio'});
  expect(radios.map(r=>r.props['aria-checked'])).toEqual([false,true]);
  expect(radios.map(r=>r.props.tabIndex)).toEqual([-1,0]);
  expect(renderer.root.findAllByProps({role:'tab'})).toHaveLength(0);
});

test('unavailable delivery stays disabled and pickup remains keyboard reachable',async()=>{
  await act(async()=>{renderer=create(React.createElement(FulfillmentPicker,{value:'DELIVERY',onChange:jest.fn(),deliveryUnavailable:true}));});
  const radios=renderer.root.findAllByProps({role:'radio'});
  expect(radios[0].props.tabIndex).toBe(0);
  expect(radios[1].props.disabled).toBe(true);
  expect(radios[1].props.tabIndex).toBe(-1);
});
