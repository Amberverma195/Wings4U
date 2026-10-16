import { CustomerAddressesService, ensureCustomerAddressExists } from "./customer-addresses.service";
import { customerAddressIdentity } from "./customer-address-identity";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const DATE = new Date("2026-07-01T12:00:00Z");
const input = { line1: "629 B Huron St unit 111", city: "London", postalCode: "N5Y4J7" };
const row = (id="one",extra={}) => ({ id,userId:USER,label:"Home",...input,isDefault:true,createdAt:DATE,updatedAt:DATE,...extra });

function database(initial: ReturnType<typeof row>[] = []) {
  let rows=structuredClone(initial), nextId=0, queue:Promise<unknown>=Promise.resolve();
  const tx = {
    $queryRaw:jest.fn().mockResolvedValue([{locked:1}]),
    customerAddress:{
      findMany:jest.fn(async ({where})=>rows.filter(row=>row.userId===where.userId).sort((a,b)=>Number(b.isDefault)-Number(a.isDefault))),
      findUnique:jest.fn(async ({where})=>rows.find(row=>row.id===where.id)??null),
      create:jest.fn(async ({data})=>{
        if(rows.some(row=>row.userId===data.userId && customerAddressIdentity(row)===customerAddressIdentity(data))) throw {code:"P2002"};
        const saved=row("new-"+(++nextId),data); rows.push(saved); return saved;
      }),
      update:jest.fn(async ({where,data})=>{
        const index=rows.findIndex(row=>row.id===where.id);
        const saved={...rows[index],...Object.fromEntries(Object.entries(data).filter(([,value])=>value!==undefined))};
        if(rows.some(row=>row.id!==saved.id && row.userId===saved.userId && customerAddressIdentity(row)===customerAddressIdentity(saved))) throw {code:"P2002"};
        rows[index]=saved; return saved;
      }),
      updateMany:jest.fn(async ({where,data})=>{
        rows=rows.map(row=>row.userId===where.userId && row.isDefault && row.id!==where.NOT?.id ? {...row,...data}:row);
        return {count:1};
      }),
      delete:jest.fn(async ({where})=>{rows=rows.filter(row=>row.id!==where.id);}),
    },
  };
  const prisma={...tx,$transaction:jest.fn(callback=>{
    const operation=queue.then(async()=>{
      const before=structuredClone(rows);
      try{return await callback(tx);}catch(error){rows=before;throw error;}
    });
    queue=operation.catch(()=>{}); return operation;
  })};
  return {prisma,tx,rows:()=>rows,service:new CustomerAddressesService(prisma as never)};
}
describe("Canonical saved customer addresses",()=>{
  it.each(["n5y4j7","N5Y4J7","N5Y 4J7"," N5Y   4J7 "])("reuses an existing address for postal code %s",async postalCode=>{
    const db=database([row()]);
    const result=await db.service.upsert(USER,{...input,line1:" 629   b huron ST unit 111 ",city:" london ",postalCode});
    expect(result.id).toBe("one"); expect(result.postal_code).toBe("N5Y 4J7");
    expect(db.rows()).toHaveLength(1); expect(result.label).toBe("Home"); expect(result.is_default).toBe(true);
  });
  it("guest migration and repeated delivery checkout reuse the same real ID without overwriting label/default",async()=>{
    const db=database([row()]);
    for(let i=0;i<3;i++){
      const result=await db.prisma.$transaction((tx:typeof db.tx)=>ensureCustomerAddressExists(tx as never,USER,{...input,postalCode:i%2?"n5y 4j7":"N5Y4J7"}));
      expect(result.id).toBe("one"); expect(result.label).toBe("Home"); expect(result.is_default).toBe(true);
    }
    expect(db.tx.customerAddress.create).not.toHaveBeenCalled();
    expect(db.tx.customerAddress.update).not.toHaveBeenCalled();
    expect(db.tx.$queryRaw).toHaveBeenCalledTimes(3);
  });
  it("ensure wraps its own transaction and appends a new guest address without clearing defaults",async()=>{
    const db=database([row()]);
    const result=await db.service.ensure(USER,{...input,line1:"20 King Street"});
    expect(result.id).toBe("new-1"); expect(result.is_default).toBe(false);
    expect(db.rows().find(row=>row.id==="one")?.isDefault).toBe(true);
    expect(db.prisma.$transaction).toHaveBeenCalled();
  });
  it.each([{line1:"629 B Huron St unit 112"},{line1:"630 B Huron St unit 111"},{city:"Toronto"}])("preserves genuinely different addresses (%j)",async extra=>{
    const db=database([row()]);
    await db.service.upsert(USER,{...input,...extra});
    expect(db.rows()).toHaveLength(2);
  });
  it("allows different customers to save the same address",async()=>{
    const db=database([row()]);
    await db.service.upsert(OTHER,input);
    expect(db.rows()).toHaveLength(2);
  });
  it("serializes simultaneous create-or-reuse requests into one saved ID",async()=>{
    const db=database();
    const results=await Promise.all(Array.from({length:8},(_,i)=>db.service.upsert(USER,{...input,postalCode:i%2?"n5y 4j7":"N5Y4J7"})));
    expect(new Set(results.map(row=>row.id)).size).toBe(1); expect(db.rows()).toHaveLength(1);
    expect(db.tx.$queryRaw).toHaveBeenCalledTimes(8);
    expect(db.tx.$queryRaw.mock.calls[0][1]).toBe(USER);
  });
  it("rejects an edit to another saved address before altering either row or the default",async()=>{
    const db=database([row(),row("two",{line1:"20 King Street",isDefault:false,label:"Work"})]);
    const before=structuredClone(db.rows());
    await expect(db.service.update(USER,"two",{...input,isDefault:true})).rejects.toMatchObject({status:409,message:"This address is already saved."});
    expect(db.rows()).toEqual(before);
    expect(db.tx.customerAddress.updateMany).not.toHaveBeenCalled();
    expect(db.tx.customerAddress.update).not.toHaveBeenCalled();
  });
  it("simultaneous edits to one new identity have one winner",async()=>{
    const db=database([row("one",{line1:"10 King Street"}),row("two",{line1:"20 King Street",isDefault:false})]);
    const results=await Promise.allSettled(["one","two"].map(id=>db.service.update(USER,id,{line1:"30 King Street"})));
    expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1);
    expect(db.rows().filter(row=>row.line1==="30 King Street")).toHaveLength(1);
  });
  it("maps database uniqueness failures to a friendly conflict and rolls back default changes",async()=>{
    const db=database([row()]);
    db.tx.customerAddress.create.mockRejectedValueOnce({code:"P2002"});
    await expect(db.service.upsert(USER,{...input,line1:"20 King Street",isDefault:true})).rejects.toMatchObject({status:409});
    expect(db.rows()[0].isDefault).toBe(true);
    expect(db.tx.customerAddress.updateMany).not.toHaveBeenCalled();
  });
  it("changes defaults atomically and preserves default on a repeated save",async()=>{
    const db=database([row(),row("two",{line1:"20 King Street",isDefault:false})]);
    await db.service.update(USER,"two",{isDefault:true});
    expect(db.rows().filter(row=>row.isDefault).map(row=>row.id)).toEqual(["two"]);
    await db.service.upsert(USER,{...input,line1:"20 King Street",isDefault:false});
    expect(db.rows().find(row=>row.id==="two")?.isDefault).toBe(true);
  });
  it("keeps list IDs authoritative and rejects other customers' edits/deletes",async()=>{
    const db=database([row()]);
    expect((await db.service.list(USER))[0].id).toBe("one");
    await expect(db.service.update(OTHER,"one",{label:"Work"})).rejects.toMatchObject({status:403});
    await expect(db.service.remove(OTHER,"one")).rejects.toMatchObject({status:403});
    await db.service.remove(USER,"one"); expect(db.rows()).toHaveLength(0);
  });
  it("rejects blank-only street/city/postal fields without writing",async()=>{
    const db=database();
    for(const extra of [{line1:"   "},{city:"\t "},{postalCode:"   "}]){
      await expect(db.service.upsert(USER,{...input,...extra})).rejects.toMatchObject({status:422});
    }
    expect(db.tx.customerAddress.create).not.toHaveBeenCalled();
  });
});
