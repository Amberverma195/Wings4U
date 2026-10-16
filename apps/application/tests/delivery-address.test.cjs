const {normalizeCanadianPostalCode,normalizeAddressText}=require('../src/lib/delivery-address');
test.each(['n5y4j7','N5Y4J7','N5Y 4J7',' N5Y   4J7 '])('mobile canonicalizes postal code %s for saved addresses and checkout',value=>{
  expect(normalizeCanadianPostalCode(value)).toBe('N5Y 4J7');
});
test('mobile preserves distinct units while collapsing street whitespace',()=>{
  expect(normalizeAddressText(' 629   B Huron St unit 111 ')).toBe('629 B Huron St unit 111');
  expect(normalizeAddressText('629 B Huron St unit 112')).not.toBe(normalizeAddressText('629 B Huron St unit 111'));
});
