"""Independent, scoped FLUX trial lease. Import is inert; providers are injected.

The provider workspace budget is the financial guard. This watchdog supplies a
separate finite lifetime and confirmed App shutdown, never an invoice estimate.
"""
import asyncio
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
import json
import math
from pathlib import Path
import re
import time

APP = re.compile(r'^ap-[A-Za-z0-9_-]+$')
NAME = re.compile(r'^mashhad-(?:flux|weights)-[a-f0-9]{12}$')
IDENTITY = ('account', 'profile', 'env', 'appName', 'createdAt', 'baselineGrossUSD',
            'usageLimitUSD', 'spendLimitUSD', 'trialMaxUSD', 'providerBudgetVerifiedAt',
            'periodStartISO', 'periodEndISO', 'deadline', 'twoPeriodCapApproved', 'gpuValidationApproved',
            'sequentialGpuTestsApproved', 'modelId', 'engineId', 'accountId', 'globalDeadlineISO',
            'speechContinuationApproved', 'previousPeriodExposureUSD',
            'filmTrialApproved', 'filmId', 'filmApprovedAt')


def millis():
    return int(time.time() * 1000)


def transient_read_error(error):
    return isinstance(error,(ConnectionError,TimeoutError)) or (type(error).__module__=='modal.exception' and type(error).__name__=='ConnectionError')


def decimal(value):
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        raise ValueError('TRIAL_BUDGET_INVALID') from None
    if not number.is_finite() or number < 0:
        raise ValueError('TRIAL_BUDGET_INVALID')
    return number


def timestamp(value):
    try:
        if re.fullmatch(r'\d{4}-\d{2}-\d{2}Z', value):
            value = value[:-1] + 'T00:00:00Z'
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            raise ValueError()
        return int(parsed.timestamp() * 1000)
    except (AttributeError, ValueError, TypeError):
        raise ValueError('TRIAL_PERIOD_INVALID') from None


def validate_lease(state, now):
    if not isinstance(state, dict) or state.get('approved') is not True:
        raise ValueError('TRIAL_APPROVAL_REQUIRED')
    sequential = state.get('sequentialGpuTestsApproved') is True
    continuation = state.get('speechContinuationApproved') is True
    film = state.get('filmTrialApproved') is True
    if film and (continuation or not sequential or state.get('filmId') != 'afterlife-20261101' or state.get('modelId') not in ('flux2-klein-4b','qwen-image-edit-2511','wan22-i2v-a14b','habibi-msa')):
        raise ValueError('TRIAL_APPROVAL_REQUIRED')
    if continuation and (not sequential or state.get('modelId') not in ('habibi-irq','habibi-egy','habibi-msa') or decimal(state.get('previousPeriodExposureUSD')) != Decimal('14.65125415')):
        raise ValueError('TRIAL_PROVIDER_CAP_INVALID')
    prefixes = {'qwen-image-edit-2511': 'qwen', 'wan22-i2v-a14b': 'wan', 'hunyuanvideo15': 'hunyuan',
                'habibi-irq': 'speech-habibi-irq', 'habibi-egy': 'speech-habibi-egy', 'habibi-msa': 'speech-habibi-msa'}
    if film:
        prefixes['flux2-klein-4b'] = 'flux'
    engine_id = state.get('engineId', '')
    if sequential:
        if state.get('modelId') not in prefixes or not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', engine_id) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', state.get('accountId', '')):
            raise ValueError('TRIAL_SCOPE_INVALID')
        expected_name = 'mashhad-' + prefixes[state['modelId']] + '-' + engine_id.replace('-', '')[:12]
        valid_name = state.get('appName') == expected_name
    else:
        valid_name = bool(NAME.fullmatch(state.get('appName', '')))
    if state.get('account') != 'basm1998ali' or state.get('profile') != 'basm1998ali' or state.get('env') != 'main' or not valid_name:
        raise ValueError('TRIAL_SCOPE_INVALID')
    if state.get('appId') is not None and not APP.fullmatch(state['appId']):
        raise ValueError('TRIAL_SCOPE_INVALID')
    for key in ('createdAt', 'providerBudgetVerifiedAt', 'deadline'):
        if type(state.get(key)) is not int or state[key] < 1:
            raise ValueError('TRIAL_CLOCK_INVALID')
    if state['createdAt'] > now + 1000 or not 0 <= now - state['providerBudgetVerifiedAt'] <= 300000:
        raise ValueError('TRIAL_PROVIDER_PROOF_STALE')
    if not now < state['deadline'] <= now + 45 * 60000:
        raise ValueError('TRIAL_DEADLINE_INVALID')
    start, end = timestamp(state.get('periodStartISO')), timestamp(state.get('periodEndISO'))
    # Use the earlier of provider cycle end and Baghdad midnight, conservatively.
    baghdad = timezone(timedelta(hours=3))
    local = datetime.fromtimestamp(now / 1000, baghdad)
    midnight = datetime.combine(local.date() + timedelta(days=1), datetime.min.time(), baghdad)
    capped_weights = state.get('usageLimitUSD') == 7 and state.get('twoPeriodCapApproved') is True and (state['appName'].startswith('mashhad-weights-') or (state['appName'].startswith('mashhad-flux-') and state.get('gpuValidationApproved') is True))
    if state.get('gpuValidationApproved') is True and not (capped_weights or sequential):
        raise ValueError('TRIAL_PROVIDER_CAP_INVALID')
    # Explicitly approved weight-only continuations use the verified UTC period
    # boundary. The lower $7 cap bounds even two full billing periods below $20
    # after subtracting the original pre-trial usage; local midnight is no reset
    # authorization or an excuse to raise the provider's account limit.
    if sequential:
        expected_stop = '2026-11-01T08:15:00Z' if film else '2026-11-01T02:00:00Z' if continuation else '2026-10-31T23:30:00Z'
        if state.get('globalDeadlineISO') != expected_stop:
            raise ValueError('TRIAL_DEADLINE_INVALID')
        if (continuation or film) and (state.get('periodStartISO') != '2026-11-01T00:00:00Z' or state.get('periodEndISO') != '2026-12-01T00:00:00Z'):
            raise ValueError('TRIAL_PERIOD_INVALID')
        global_end = timestamp(state['globalDeadlineISO'])
        if film and (type(state.get('filmApprovedAt')) is not int or not 0 < state['filmApprovedAt'] <= state['createdAt'] <= now + 1000 or global_end > state['filmApprovedAt'] + 4 * 3600000 or now < state['filmApprovedAt']):
            raise ValueError('TRIAL_DEADLINE_INVALID')
        if state['deadline'] > global_end or now >= global_end:
            raise ValueError('TRIAL_DEADLINE_INVALID')
    boundary = end if (capped_weights or sequential) else min(end, int(midnight.timestamp() * 1000))
    if not start <= now < end or state['deadline'] > boundary - 20 * 60000:
        raise ValueError('TRIAL_BILLING_ROLLOVER_RISK')
    base, limit, maximum = (decimal(state.get(k)) for k in ('baselineGrossUSD', 'usageLimitUSD', 'trialMaxUSD'))
    allowed_limit = (not film and not sequential and limit == 26 and 0 < limit-base <= maximum) or (capped_weights and 0 < limit-base and 2*limit-base <= maximum) or (sequential and not continuation and not film and limit == 21 and base == Decimal('6.34874585') and 0 < limit-base <= maximum) or (film and limit == 15 and base == 0 and maximum == 15) or (continuation and limit == 5 and base == 0 and decimal(state['previousPeriodExposureUSD'])+limit <= maximum)
    if maximum != (15 if film else 20) or not allowed_limit or decimal(state.get('spendLimitUSD')) != 0:
        raise ValueError('TRIAL_PROVIDER_CAP_INVALID')
    return {key: state.get(key) for key in IDENTITY}


def atomic_write(target, state):
    path = Path(target)
    # Windows readers may briefly deny replacement of an otherwise safe state
    # file. Retry only access/sharing errors; corruption or scope errors are fatal.
    for attempt in range(6):
        if path.is_symlink() or path.resolve() != path.absolute():
            raise ValueError('TRIAL_STATE_PATH_INVALID')
        temporary = path.with_name(path.name + '.watchdog.pending')
        if temporary.is_symlink():
            raise ValueError('TRIAL_STATE_PATH_INVALID')
        try:
            temporary.write_text(json.dumps(state, sort_keys=True), encoding='utf-8')
            temporary.replace(path)
            return
        except PermissionError:
            if attempt == 5:
                raise
            time.sleep(min(0.05 * 2 ** attempt, 0.5))


class TrialWatchdog:
    def __init__(self, state_path, provider, *, now=millis, sleep=asyncio.sleep):
        self.path = Path(state_path).absolute()
        self.control = self.path.with_name(self.path.name + '.control.json')
        self.provider, self.now, self.sleep = provider, now, sleep
        if self.path.is_symlink() or self.path.resolve() != self.path:
            raise ValueError('TRIAL_STATE_PATH_INVALID')
        self.state = json.loads(self.path.read_text(encoding='utf-8'))
        self.identity = validate_lease(self.state, now())
        self.bound = None
        self.stop_reason = None
        self.done = False

    def controls(self):
        if not self.control.exists():
            return {}
        if self.control.is_symlink() or self.control.stat().st_size > 4096:
            raise ValueError('TRIAL_CONTROL_INVALID')
        value = json.loads(self.control.read_text(encoding='utf-8'))
        if not isinstance(value, dict) or set(value) - {'stopRequested', 'mainStatus', 'finishedNotDispatched'} or value.get('mainStatus', 'running') not in ('running', 'completed', 'failed'):
            raise ValueError('TRIAL_CONTROL_INVALID')
        return value

    def match_app(self, app):
        return isinstance(app, dict) and APP.fullmatch(app.get('id', '')) and app.get('name') == self.identity['appName'] and app.get('env') == self.identity['env'] and type(app.get('createdAt')) in (int, float) and math.isfinite(app['createdAt']) and app['createdAt'] >= self.identity['createdAt'] - 5000

    async def step(self):
        if self.done:
            return self.state
        now = self.now()
        try:
            controls = self.controls()
            disk = json.loads(self.path.read_text(encoding='utf-8'))
            if any(disk.get(k) != v for k, v in self.identity.items()) or disk.get('approved') is not True:
                self.stop_reason = self.stop_reason or 'TRIAL_LEASE_CHANGED'
            if controls.get('stopRequested') is True or controls.get('mainStatus') in ('completed', 'failed'):
                self.stop_reason = self.stop_reason or 'TRIAL_MAIN_FINISHED'
            if now >= self.identity['deadline']:
                self.stop_reason = self.stop_reason or 'TRIAL_DEADLINE_REACHED'
            try:
                observation = await asyncio.wait_for(self.provider.observe(self.state), 6)
            except Exception as error:
                if not transient_read_error(error):raise
                # Metadata only, never repeat deployment/start/spawn. A second
                # error still enters the existing fail-closed scoped shutdown.
                await self.sleep(0.5)
                observation = await asyncio.wait_for(self.provider.observe(self.state), 6)
            # Provider reads may consume most of a heartbeat period. Validate
            # the deadline again after the read and timestamp the completed
            # observation, rather than making fresh proof look stale already.
            now = self.now()
            if now >= self.identity['deadline']:
                self.stop_reason = self.stop_reason or 'TRIAL_DEADLINE_REACHED'
            if observation.get('workspace') != self.identity['account'] or observation.get('env') != self.identity['env']:
                raise ValueError('TRIAL_PROVIDER_SCOPE_INVALID')
            current = decimal(observation.get('grossUSD'))
            if current < decimal(self.identity['baselineGrossUSD']):
                self.stop_reason = self.stop_reason or 'TRIAL_BILLING_PERIOD_CHANGED'
            if current - decimal(self.identity['baselineGrossUSD']) >= 18 or current >= decimal(self.identity['usageLimitUSD']):
                self.stop_reason = self.stop_reason or 'TRIAL_COST_GUARD_REACHED'
            self.state['currentGrossUSD'] = str(current)
            apps = observation.get('apps')
            if not isinstance(apps, list):
                raise ValueError('TRIAL_PROVIDER_STATE_UNKNOWN')
            candidates = [a for a in apps if a.get('name') == self.identity['appName'] and not (a.get('state')=='stopped' and a.get('id')!=self.bound and a.get('createdAt',now)>=0 and a.get('createdAt',now)<self.identity['createdAt']-5000)]
            if len(candidates) > 1 or any(not self.match_app(a) for a in candidates):
                self.stop_reason = self.stop_reason or 'TRIAL_APP_SCOPE_UNCONFIRMED'
            elif candidates:
                candidate = candidates[0]
                if self.bound and candidate['id'] != self.bound:
                    self.stop_reason = self.stop_reason or 'TRIAL_APP_REPLACED'
                elif self.state.get('appId') not in (None, candidate['id']):
                    self.stop_reason = self.stop_reason or 'TRIAL_APP_SCOPE_UNCONFIRMED'
                else:
                    self.bound = candidate['id']
                    self.state['appId'] = self.bound
                    self.state['boundAppId'] = self.bound
            if any(a.get('id') != self.bound and a.get('state') != 'stopped' for a in apps):
                self.stop_reason = self.stop_reason or 'TRIAL_OTHER_APP_ACTIVE'
            if self.stop_reason and self.bound:
                await self.provider.stop(self.bound, self.identity['appName'], self.identity['env'])
                confirmed = await self.provider.confirm_stopped(self.bound, self.identity['appName'], self.identity['env'])
                if confirmed is True:
                    self.state.update(status='stopped', cloudStopped=True, stoppedAt=now)
                    self.done = True
                else:
                    self.state.update(status='stop_pending', cloudStopped=False)
            elif self.stop_reason:
                # An app may be created by an in-flight builder after an empty list.
                # Keep watching until the controller proves it never dispatched.
                if controls.get('finishedNotDispatched') is True and not candidates:
                    self.state.update(status='finished_not_dispatched', cloudStopped=True)
                    self.done = True
                else:
                    self.state.update(status='stop_pending_no_app', cloudStopped=False)
            else:
                self.state.update(status='watching' if self.bound else 'armed', cloudStopped=False)
        except Exception as error:
            self.state['lastSafeErrorType'] = type(error).__name__
            self.stop_reason = self.stop_reason or 'TRIAL_PROVIDER_STATE_UNKNOWN'
            self.state.update(status='uncertain', cloudStopped=False)
            if self.bound:
                try:
                    await self.provider.stop(self.bound, self.identity['appName'], self.identity['env'])
                    if await self.provider.confirm_stopped(self.bound, self.identity['appName'], self.identity['env']):
                        self.state.update(status='stopped', cloudStopped=True, stoppedAt=now)
                        self.done = True
                except Exception:
                    pass
        self.state.update(heartbeatAt=now, stopReason=self.stop_reason, watchdogPID=__import__('os').getpid())
        try:
            atomic_write(self.path, self.state)
        except BaseException as error:
            self.state['lastSafeErrorType'] = type(error).__name__
            self.stop_reason = self.stop_reason or 'TRIAL_STATE_WRITE_FAILED'
            await self.shutdown_until_stopped()
            raise
        return self.state

    async def shutdown_until_stopped(self):
        """Fatal cleanup never needs the writable state file to stop owned work.

        Keep this process alive if provider shutdown is uncertain. An in-flight
        builder may create the exact fresh App after the first empty observation.
        Unrelated/replacement Apps are never given shutdown authority.
        """
        while not self.done:
            now = self.now()
            self.state.update(status='uncertain', cloudStopped=False)
            try:
                if not self.bound:
                    observation = await asyncio.wait_for(self.provider.observe(self.state), 6)
                    if observation.get('workspace') != self.identity['account'] or observation.get('env') != self.identity['env']:
                        raise ValueError('TRIAL_PROVIDER_SCOPE_INVALID')
                    apps = observation.get('apps')
                    if not isinstance(apps, list):
                        raise ValueError('TRIAL_PROVIDER_STATE_UNKNOWN')
                    candidates = [a for a in apps if a.get('name') == self.identity['appName'] and a.get('state') != 'stopped']
                    if len(candidates) == 1 and self.match_app(candidates[0]) and self.state.get('appId') in (None, candidates[0]['id']):
                        self.bound = candidates[0]['id']
                        self.state.update(appId=self.bound, boundAppId=self.bound)
                    elif not candidates and self.controls().get('finishedNotDispatched') is True:
                        self.state.update(status='finished_not_dispatched', cloudStopped=True)
                        self.done = True
                if self.bound:
                    await asyncio.wait_for(self.provider.stop(self.bound, self.identity['appName'], self.identity['env']), 20)
                    confirmed = await asyncio.wait_for(self.provider.confirm_stopped(self.bound, self.identity['appName'], self.identity['env']), 20)
                    if confirmed is True:
                        self.state.update(status='stopped', cloudStopped=True, stoppedAt=now)
                        self.done = True
                    else:
                        self.state.update(status='stop_pending', cloudStopped=False)
            except Exception as error:
                self.state['lastSafeErrorType'] = type(error).__name__
            self.state.update(heartbeatAt=now, stopReason=self.stop_reason, watchdogPID=__import__('os').getpid())
            try:
                atomic_write(self.path, self.state)
            except Exception as error:
                # Persistence failure cannot suppress provider-side cleanup.
                self.state['lastSafeErrorType'] = type(error).__name__
            if not self.done:
                await asyncio.sleep(1)
        return self.state

    async def run(self):
        try:
            while not self.done:
                await self.step()
                if not self.done:
                    await self.sleep(5)
            return self.state
        except BaseException as error:
            self.state['lastSafeErrorType'] = type(error).__name__
            self.stop_reason = self.stop_reason or 'TRIAL_WATCHDOG_PROCESS_FAILED'
            raise
        finally:
            if not self.done:
                # A fatal sleep/read/write/cancellation must stop the exact App
                # before it can propagate to the CLI's sanitized error handler.
                cleanup = asyncio.create_task(self.shutdown_until_stopped())
                while not cleanup.done():
                    try:
                        await asyncio.shield(cleanup)
                    except asyncio.CancelledError:
                        continue
                cleanup.result()
