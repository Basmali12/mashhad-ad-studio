import {ConvexError} from 'convex/values';

export const subscriptionContact='https://wa.me/9647729373260?text='+encodeURIComponent('أريد الاشتراك وتفعيل حسابي في مشهد.');
export function subscriptionsClosed(){return process.env.CUSTOMER_ACCESS_DISABLED==='true';}
export function assertSubscriptionAccess(){
 if(subscriptionsClosed())throw new ConvexError('الدخول متوقف للحسابات الجديدة والقديمة. تواصل للاشتراك وتفعيل اشتراكك.');
}
