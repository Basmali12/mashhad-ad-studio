// Only these commands can dispatch new billable provider work. A failed read
// must never turn the entire workspace into an uncertain paid operation.
const paidCommands = new Set(['admin.engine.test.execute','director.research','director.message','director.plan','rental.start','project.launch','project.generate','project.resume','chat.submit','plan.submit','review.submit','project.preview.execute','admin.prepare.execute','admin.test.execute','admin.engine.start','admin.engine.prepare','production.approve','production.retry']);
export const mayDispatchPaidWork = (operation:string) => paidCommands.has(operation);
