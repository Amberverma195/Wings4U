const { handleRadioGroupKeyDown } = require('../src/lib/radio-group');

function fixture() {
  const group = {};
  const buttons = Array.from({ length: 4 }, () => ({ disabled: false, getAttribute: () => null, closest: () => group, focus: jest.fn(), click: jest.fn() }));
  buttons[1].disabled = true;
  group.querySelectorAll = () => buttons;
  const press = (key, index) => {
    const event = { key, target: buttons[index], currentTarget: group, preventDefault: jest.fn() };
    handleRadioGroupKeyDown(event);
    return event;
  };
  return { buttons, group, press };
}

test.each([['ArrowRight',0,2],['ArrowDown',3,0],['ArrowLeft',0,3],['ArrowUp',2,0],['Home',3,0],['End',0,3]])('%s moves focus and selects, wrapping and skipping disabled radios', (key, start, destination) => {
  const { buttons, press } = fixture();
  expect(press(key,start).preventDefault).toHaveBeenCalled();
  buttons.forEach((button,index) => {
    expect(button.focus).toHaveBeenCalledTimes(index===destination?1:0);
    expect(button.click).toHaveBeenCalledTimes(index===destination?1:0);
  });
});

test.each(['Tab','Enter',' '])('%s keeps native keyboard behavior', key => {
  const { buttons, press } = fixture();
  expect(press(key,0).preventDefault).not.toHaveBeenCalled();
  expect(buttons[0].click).not.toHaveBeenCalled();
});

test('a nested group does not select radios in an outer group', () => {
  const { buttons, press } = fixture();
  buttons[0].closest = () => ({});
  expect(press('ArrowRight',0).preventDefault).not.toHaveBeenCalled();
  buttons.forEach(button=>expect(button.click).not.toHaveBeenCalled());
});
