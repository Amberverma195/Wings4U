const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('react-native', () => ({ View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', StyleSheet: { create: v => v }, Linking: { openURL: jest.fn(async()=>{}) }, Alert: { alert: jest.fn() } }));
jest.mock('../src/lib/env', () => ({ getPrivacyPolicyUrl: () => 'https://www.wings4ulondon.ca/privacy', getTermsOfServiceUrl: () => 'https://www.wings4ulondon.ca/terms' }));
const { LegalLinks } = require('../src/components/legal-links');
const { Linking, Alert } = require('react-native');
let renderer;
afterEach(async()=>{if(renderer)await act(async()=>renderer.unmount());renderer=null;jest.clearAllMocks();});
test('accessible legal links open the established public pages without account/API actions',async()=>{
  await act(async()=>{renderer=create(React.createElement(LegalLinks));});
  const links=renderer.root.findAllByProps({accessibilityRole:'link'});expect(links).toHaveLength(2);
  expect(links[0].props.accessibilityLabel).toContain('opens in your browser');
  await act(async()=>links[0].props.onPress());await act(async()=>links[1].props.onPress());
  expect(Linking.openURL.mock.calls.map(call=>call[0])).toEqual(['https://www.wings4ulondon.ca/privacy','https://www.wings4ulondon.ca/terms']);
});
test('failed browser opening gives an accessible alternative URL',async()=>{
  Linking.openURL.mockRejectedValueOnce(new Error('No browser'));
  await act(async()=>{renderer=create(React.createElement(LegalLinks));});
  await act(async()=>renderer.root.findAllByProps({accessibilityRole:'link'})[0].props.onPress());
  expect(Alert.alert).toHaveBeenCalledWith('Unable to open document',expect.stringContaining('/privacy'));
});
test('registration and profile surfaces include the same legal entry component',()=>{
  const fs=require('node:fs'),path=require('node:path');
  for(const file of ['../src/components/auth-sheet.tsx','../app/(tabs)/profile.tsx'])expect(fs.readFileSync(path.join(__dirname,file),'utf8')).toContain('<LegalLinks />');
});
