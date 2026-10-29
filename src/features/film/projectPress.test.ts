import {it,expect,vi,afterEach} from 'vitest';
import {projectPress} from './projectPress';
import {mayDispatchPaidWork} from '../../../shared/film-request-policy';
afterEach(()=>vi.useRealTimers());
it('long press opens options once and consumes the following click',()=>{vi.useFakeTimers();const open=vi.fn(),press=projectPress(open);press.start(2,3);vi.advanceTimersByTime(549);expect(open).not.toHaveBeenCalled();vi.advanceTimersByTime(1);press.cancel();expect(open).toHaveBeenCalledOnce();expect(press.consume()).toBe(true);expect(press.consume()).toBe(false);});
it('short click, scroll movement and cancellation never open options',()=>{vi.useFakeTimers();const open=vi.fn(),press=projectPress(open);press.start(0,0);press.cancel();vi.runAllTimers();expect(press.consume()).toBe(false);press.start(0,0);press.move(0,25);vi.runAllTimers();expect(open).not.toHaveBeenCalled();press.context();expect(open).toHaveBeenCalledOnce();expect(press.consume()).toBe(true);});
it('read and metadata failures do not become ambiguous paid generation',()=>{for(const op of ['session','projects.list','project.get','project.follow','wallet','rental.status','project.organize'])expect(mayDispatchPaidWork(op)).toBe(false);for(const op of ['chat.submit','project.launch','project.preview.execute','rental.start','project.resume','admin.test.execute'])expect(mayDispatchPaidWork(op)).toBe(true);});
