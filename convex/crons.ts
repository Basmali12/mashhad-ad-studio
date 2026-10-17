import {cronJobs} from 'convex/server';import {internal} from './_generated/api';
const crons=cronJobs();
// Source only: not deployed to the live app. Monday 03:00 Baghdad; no provider/model requests.
crons.weekly('weekly-reels-rules',{dayOfWeek:'monday',hourUTC:0,minuteUTC:0},internal.reelsInsights.weekly,{});
crons.interval('retry-media-retention',{minutes:15},internal.reelsRetention.sweep,{});
export default crons;
