import {providerFetch as fetch} from './network.mjs';
import { createHmac, randomUUID } from 'node:crypto';
import { FILM_OPERATIONS } from "../../shared/film-contracts.ts";
// Browser consumers import the frozen type-only contract from services/film-engine/engine/film-contracts.
const operations = new Set(FILM_OPERATIONS);
const LIMIT = 262144;
const FOLLOW = 'افتح متابعة الجلسة أو المشروع لمعرفة الحالة؛ لا تبدأ محاولة مدفوعة جديدة تلقائياً.';
const fail = (error, message = 'تعذر إكمال الطلب بأمان.', followExisting = false) => ({ error, message: message + (followExisting ? ' ' + FOLLOW : ''), followExisting });
const record = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const id = (x) => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(x);
// eslint-disable-next-line no-control-regex -- reject control characters at the authenticated input boundary.
const text = (x, max = 20000) => typeof x === 'string' && x.length > 0 && x.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(x);
const money = (x) => typeof x === 'string' && /^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/.test(x);
const yes = x => x === true;
const bool = x => typeof x === 'boolean';
const integer = x => Number.isSafeInteger(x) && x >= 0;
const date = x => x === null || (integer(x) && x > 0);
const short = x => text(x, 120);
const fields = {
    'rental.quote': { serverId: id },
    'rental.start': { serverId: id, revision: integer, priceMicroUSD: integer, approved: yes, requestId: id },
    'rental.status': { id }, 'rental.stop': { id },
    'project.save': { 'id?': id, name: short, story: x => text(x), seconds: x => integer(x) && x >= 10 && x <= 300 && x % 10 === 0, orientation: x => ['portrait', 'landscape'].includes(x) },
    'project.reference.view': { projectId: id }, 'project.reference.ticket': { projectId: id }, 'project.reference.remove': { projectId: id },
    'project.get': { id }, 'project.follow': { id },
    'chat.submit': { projectId: id, message: x => text(x), approved: yes },
    'plan.submit': { projectId: id, approved: yes },
    'review.submit': { projectId: id, approved: yes },
    'text.status': { projectId: id }, 'plan.status': { projectId: id },
    'project.generate': { projectId: id, rentalId: id, approved: yes, 'directorFollow?': bool },
    'project.resume': { projectId: id, rentalId: id, approved: yes, 'directorFollow?': bool },
    'project.merge': { projectId: id }, 'media.ticket': { projectId: id, index: x => x === 'merged' || (integer(x) && x < 30) },
    'admin.credit.add': { customerId: id, amountUSD: money, requestId: id },
    'admin.account.link': { name: short, tokenId: x => typeof x === 'string' && /^ak-[A-Za-z0-9_-]{8,200}$/.test(x), tokenSecret: x => typeof x === 'string' && /^as-[A-Za-z0-9_-]{8,200}$/.test(x) },
    'admin.account.inspect': { accountId: id }, 'admin.account.activate': { accountId: id }, 'admin.account.unlink': { accountId: id, approved: yes },
    'admin.account.lock': { accountId: id, locked: bool }, 'admin.account.stop': { accountId: id, approved: yes },
    'admin.prepare.quote': { accountId: id }, 'admin.prepare.execute': { quoteId: id, approved: yes },
    'admin.test.quote': { id, prompt: x => text(x, 9000), audioContract: x => record(x) && JSON.stringify(x).length <= 20000 },
    'admin.test.execute': { quoteId: id, approved: yes }, 'admin.operation.status': { id },
    'admin.slot.save': { 'id?': id, accountId: id, name: short, hourPriceUSD: money, 'gpu?': x => ['RTX-PRO-6000', 'L40S'].includes(x) },
    'admin.slot.verify': { id, jobId: id, reviewed: yes }, 'admin.slot.publish': { id, 'testingOnly?': bool, 'approved?': yes },
    'admin.slot.retire': { id, approved: yes },
    'admin.slot.lock': { id, locked: bool }, 'admin.slot.stop': { id, approved: yes },
    'admin.capacity.save': { accountId: id, maxConcurrent: x => x === 1 || x === 2 },
    'admin.billing.save': { accountId: id, remainingUSD: x => x === null || money(x), expiresAt: date, renewsAt: date },
    'admin.alert.ack': { id }, 'admin.text.key.save': { key: x => typeof x === 'string' && /^sk-[A-Za-z0-9_-]{12,500}$/.test(x) },
};
function validInput(operation, input) {
    if (!record(input))
        return false;
    const schema = fields[operation] ?? {};
    const allowed = Object.keys(schema).map(k => k.replace(/\?$/, ''));
    return Object.keys(input).every(k => allowed.includes(k)) && Object.entries(schema).every(([key, check]) => {
        const optional = key.endsWith('?');
        const name = key.replace(/\?$/, '');
        return optional && !(name in input) || check(input[name]);
    });
}
const wallet = { balanceMicroUSD: 'value', expiresAt: 'value', reservedMicroUSD: 'value', activeRentalId: 'id', lots: [{ amountMicroUSD: 'value', remainingMicroUSD: 'value', expiresAt: 'value', expired: 'value' }] };
const server = { id: 'id', name: 'text', gpu: 'text', ram: 'value', cpu: 'value', pricePerHourUSD: 'value', state: 'text', availability: 'text' };
const rental = { id: 'id', serverId: 'id', state: 'text', elapsedSeconds: 'value', billedMicroUSD: 'value', hourPriceUSD: 'value', lowFunds: 'value', phase: 'text', completed: 'value', total: 'value', stopReason: 'text', message: 'text' };
const visualReview={index:'value',model:'text',summary:'text',visibleText:'text',continuity:'text',causalOrder:'text',audioAssessment:'text',findings:['text'],suggestedCorrections:['text'],sampleCount:'value',computedUSD:'value',invoiceUSD:'value'};
const project = {directorFollow:'value',reviewPending:'value',reviewState:'text',visualReviews:[visualReview], id: 'id', name: 'text', story: 'text', messages: [{ role: 'text', content: 'text' }], seconds: 'value', orientation: 'text', state: 'text', reference: { mime: 'text', size: 'value', width: 'value', height: 'value', uploadedAt: 'value' }, textPending: 'value', textUncertain: 'value', textCostPolicy: 'text', planningCompletedScenes: 'value', merge: { status: 'text', error: 'text', duration: 'value', width: 'value', height: 'value', nativeAudio: 'value' }, scenes: [{ index: 'value', title: 'text', status: 'text', dialogue: [{ speaker: 'text', text: 'text' }], phase: 'text', completed: 'value', total: 'value', ready: 'value' }], error: 'text' };
const customerShapes = {
    session: { user: { id: 'id', name: 'text' }, wallet, servers: [server], enabled: 'value', planningEnabled: 'value', capabilities: { referenceUpload: 'value', ingredients: 'value', voiceCloning: 'value', lastFrameContinuity: 'value', nativeAudio: 'value', wholeFilmMerge: 'value' } },
    wallet, 'servers.list': [server], 'rental.quote': { serverId: 'id', revision: 'value', priceMicroUSD: 'value', pricePerHourUSD: 'value', minimumCreditUSD: 'value', warning: 'text', canStart: 'value' },
    'rental.start': rental, 'rental.status': rental, 'rental.stop': rental, 'projects.list': [project],
    'project.reference.view': { url: 'referenceUrl', expires: 'value' }, 'project.reference.ticket': { url: 'uploadUrl', expires: 'value', maxBytes: 'value' }, 'project.reference.remove': project, 'project.save': project, 'project.get': project, 'project.follow': project, 'text.status': project, 'plan.status': project, 'project.merge': project,
    'chat.submit': { accepted: 'value', textCostPolicy: 'text' }, 'plan.submit': { accepted: 'value', textCostPolicy: 'text' }, 'review.submit': { accepted: 'value', textCostPolicy: 'text' },
    'project.generate': { accepted: 'value' }, 'project.resume': { accepted: 'value' }, 'media.ticket': { url: 'url', expires: 'value' },
};
function safeText(value, secrets, customer) {
    let out = value;
    for (const secret of secrets)
        if (secret)
            out = out.split(secret).join('[محجوب]');
    out = out.replace(/\b(?:sk-|ak-|as-)[A-Za-z0-9_-]{8,}/g, '[محجوب]');
    // Diagnostics/paths belong in the service, never in customer display strings.
    out = out.replace(/https?:\/\/\S+|(?:[a-zA-Z]:\\|\/(?:home|srv|tmp|var)\/)[^\s]*/g, '[محجوب]');
    if (customer)
        out = out.replace(/modal|مودال/gi, 'مزود الحوسبة');
    return out;
}
function projectShape(value, shape, secrets) {
    if (value === null)
        return null;
    if (Array.isArray(shape))
        return Array.isArray(value) ? value.map(x => projectShape(x, shape[0], secrets)) : [];
    if (typeof shape === 'object') {
        if (!record(value))
            return null;
        return Object.fromEntries(Object.entries(shape).filter(([k]) => k in value).map(([k, s]) => [k, k === 'error' && value[k] ? 'العملية تحتاج مراجعة؛ تابع الحالة دون إعادة تلقائية.' : projectShape(value[k], s, secrets)]));
    }
    if (shape === 'value')
        return typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) ? value : null;
    if (typeof value !== 'string')
        return null;
    if (shape === 'id')
        return id(value) && !/modal|مودال/i.test(value) ? value : null;
    if (shape === 'referenceUrl') {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || !/^\/api\/film-reference-view\/[A-Za-z0-9_-]+$/.test(url.pathname) || url.origin !== new URL(secrets[1]).origin || secrets.some((s, i) => i !== 1 && s && value.includes(s)))
            throw Error('INVALID_UPLOAD');
        return value;
    }
    if (shape === 'uploadUrl') {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || !/^\/api\/film-reference\/[A-Za-z0-9_-]+$/.test(url.pathname) || url.origin !== new URL(secrets[1]).origin || secrets.some((s, i) => i !== 1 && s && value.includes(s)))
            throw Error('INVALID_UPLOAD');
        return value;
    }
    if (shape === 'url') {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || !/^\/api\/film-media\/[A-Za-z0-9_-]+$/.test(url.pathname) || secrets.some((s, i) => i !== 1 && s && value.includes(s)))
            throw Error('INVALID_MEDIA');
        return value; // Opaque signature bytes must stay intact.
    }
    return safeText(value, secrets, true);
}
// Administrator DTO keys are also allowlisted. Credentials and raw exception/trace fields have no entry.
const adminKeys = new Set(('id label name workspace role mode volume createdAt updatedAt activated discovery ready checkedAt files size hasHF billing capacity weightsReady slots activeCount accountId gpu cpu ram hourMicros published locked revision settings testJobId visualAudioReviewedAt reviewedQualityContract maxConcurrent source remainingMicroUSD expiresAt renewsAt customerId wallet balanceMicroUSD reservedMicroUSD activeRentalId lots amountMicroUSD expired remaining amount email serverId state elapsedSeconds billedMicroUSD hourPriceUSD lowFunds phase completed total stopReason message providerRecordedUSD uncoveredMicroUSD estimatedSupplierUSD supplierCostSource type acknowledged configured model savedAt pricing maximumOutputTokens monthlyLimitUSD note inputPerMillionUSD outputPerMillionUSD saved updated requested verified unlinked removed action sourceId estimate rate resourceWindowUSD maximumUSD minimumUSD costUSD cpuUSD gpuUSD ramUSD storageUSD startupSeconds budget timeout startup idleSeconds quality contract nativeAudio seconds width height plan transport steps warning expiresAt consumed paidEnabled requiresExplicitApproval quoteId jobId status cloudStopped startedAt finishedAt events kind global_completed global_total result videoVerified generationSucceeded recordedCost usd sha256 elapsedSeconds probeVerified verificationOnly gpuUsed transferredBytes cloud_stopped cleanup stoppedAt readyAt progress endpoint credentialFields tokenIdLabel tokenSecretLabel keyLabel creditBalanceUSD creditRenewalAt subscriptionExpiresAt availability renewalAt').split(' '));
for (const key of ('ramLimit orientation seed expectedSeconds windowSeconds manualControl recordedUSD url checked storageGiBMonth profile nativeWidth nativeHeight output pipeline videoDecoder textQualityRequired fps frames convVAE offload fp8 inputUSDPerMillion outputUSDPerMillion inputPerMillion outputPerMillion requiredBytes sourceVolume destinationVolume modelRepo modelRevision licenseAccepted localStagingAvailableBytes localStagingRequiredBytes localStagingReady blockingReason resume storageUSDPerMonth storageNote integrityReadBytes networkCostUSD buildCostUSD workerReady executionReady workerApp cpuSettings cpuEstimate missingCorruptFiles productionQuality manifestMatch valid').split(' '))
    adminKeys.add(key);
for (const key of ('manifestId manifestFingerprint workerFingerprint transferPlanFingerprint sourceIntegrityReadBytes destinationIntegrityReadBytes totalIntegrityReadBytes usesHostDisk mode verificationStrategy destinationVerifierMayDeploy orchestration sourceCpuCalls totalWindowSeconds sourceWindowSeconds destination calls ramGiB timeoutSeconds startupSeconds idleSeconds windowSeconds gpuUsed networkListReferenceUSD compute billingWorkspace').split(' '))
    adminKeys.add(key);
for (const key of ('confirmed pending jobs rentals standaloneActiveCount').split(' '))
    adminKeys.add(key);
for (const key of ('retired retiredAt unlinked unlinkedAt remoteResourcesDeleted providerTokenRevoked').split(' '))
    adminKeys.add(key);
for(const key of ['error','error_type','app_id','running_containers','tasks','testingOnly','trialPublishedAt'])adminKeys.add(key);
function adminDTO(value, secrets, depth = 0) {
    if (record(value) && typeof value.reason === 'string' && typeof value.subject === 'string' && 'acknowledged' in value) {
        const d = record(value.details) ? value.details : {};
        return { id: id(value.id) ? value.id : null, reason: safeText(value.reason, secrets, false), subject: safeText(value.subject, secrets, false), createdAt: integer(value.createdAt) ? value.createdAt : null, acknowledged: value.acknowledged === true, details: { ...(typeof d.knownReason === 'string' ? { knownReason: safeText(d.knownReason, secrets, false) } : {}), ...(id(d.accountId) ? { accountId: d.accountId } : {}), ...(d.source === 'administrator' ? { source: 'administrator' } : {}), ...(date(d.expiresAt) ? { expiresAt: d.expiresAt } : {}) } };
    }
    if (depth > 15)
        return null;
    if (Array.isArray(value))
        return value.map(x => adminDTO(x, secrets, depth + 1));
    if (record(value))
        return Object.fromEntries(Object.entries(value).filter(([k]) => adminKeys.has(k) && k !== 'endpoint').map(([k, v]) => [k, adminDTO(v, secrets, depth + 1)]));
    if (typeof value === 'string')
        return safeText(value, secrets, false);
    return typeof value === 'boolean' || typeof value === 'number' || value === null ? value : null;
}
const safeErrors = {
    LOCAL_ARTIFACT_NOT_WRITABLE: 'مجلد حفظ الفيديو غير قابل للكتابة على الخادم؛ لم يبدأ تشغيل GPU. راجع صلاحيات خدمة الملفات.',
    SLOT_RETIRED: 'المحرك متقاعد نهائياً؛ سجله محفوظ ولا يمكن إعادة نشره أو تشغيله.',
    ACCOUNT_UNLINKED: 'فُصل ربط الحساب؛ لم يبدأ تشغيل جديد.',
    STOP_AND_RECONCILE_JOBS_FIRST: 'لم يُؤكد إغلاق كل موارد الحساب أو النقل منه؛ أوقف العمليات وتابع التحقق أولاً.',
    SOURCE_ACTIVE_PROFILE_NOT_READY: 'المصدر الأساسي لا يملك كل ملفات النموذج المختار بالحالة المطلوبة؛ لم يبدأ النقل.',
    ACTIVE_PROFILE_REQUIRES_CLOUD_VOLUME_SOURCE: 'هذا النموذج يحتاج خطة نقل CPU سحابية معتمدة من المصدر الأساسي؛ لا تنزيل تلقائي بديل.',
    TRANSFER_PROFILE_CHANGED_REQUOTE: 'تغير عقد ملفات النموذج؛ راجع عرض تجهيز جديداً قبل النقل.',
    TRANSFER_PLAN_CHANGED_REQUOTE: 'تغيرت قائمة الملفات أو بصمتها؛ يلزم عرض تجهيز جديد.',
    TRANSFER_SOURCE_NOT_APPROVED: 'مصدر الملفات لا يطابق المصدر المعتمد.',
    CLOUD_WORKER_NOT_DEPLOYED: 'عامل النقل غير جاهز لعقد الملفات الحالي؛ يلزم تجهيز معتمد قبل التنفيذ.',
    REFERENCE_LOCKED: 'لا يمكن تعديل الصورة أثناء المعالجة أو بعد محاولة مشهد.', REFERENCE_INVALID: 'الصورة المرجعية غير سليمة.', REFERENCE_QUOTA: 'بلغت مساحة الصور المرجعية المتاحة لحسابك. راجع الإدارة؛ لم تُحذف صورك.',
    INSUFFICIENT_CREDIT: 'رصيدك لا يكفي. اشحن محفظة الأفلام أولاً.', SERVER_LOCKED: 'المحرك مقفول من الإدارة.', SERVER_BUSY: 'المحرك مشغول حالياً.', USER_HAS_RENTAL: 'لديك جلسة قائمة؛ تابعها أولاً.', NOT_FOUND: 'العنصر غير موجود أو غير متاح لك.', FORBIDDEN: 'هذه العملية للمسؤول فقط.', APPROVAL_REQUIRED: 'راجع السعر ووافق على التكلفة أولاً.', PAID_DISABLED: 'التشغيل المدفوع مقفل.', INVALID_INPUT: 'راجع الحقول المطلوبة.', INVALID_MONEY: 'اكتب مبلغاً صحيحاً بالدولار.', TEXT_DISABLED: 'كتابة القصة غير مفعلة.', RENTAL_NOT_READY: 'المحرك غير جاهز بعد.', PLAN_REQUIRED: 'اعتمد تقرير الفيلم أولاً.', COST_CHANGED: 'تغير العرض؛ راجع السعر والإعدادات مجدداً.', NO_CAPACITY: 'بلغ الحساب حد الجلسات.', REAL_GPU_TEST_REQUIRED: 'يلزم اختبار فعلي ومراجعة الصورة والصوت.', MAX_TWO_SLOTS: 'الحد محركان لكل حساب.', ACCOUNT_IN_USE: 'الحساب مرتبط بمحركات أو جلسات.', PRIMARY_ACCOUNT_IS_FIXED: 'لا يمكن فصل الحساب الأساسي.', IDEMPOTENCY_CONFLICT: 'معرّف العملية مستخدم ببيانات أخرى.', SCENE_ALREADY_ATTEMPTED: 'للمشهد محاولة محفوظة تحتاج متابعة.',
};
async function boundedJSON(response) {
    if (Number(response.headers.get('content-length')) > LIMIT)
        throw Error('RESPONSE_TOO_LARGE');
    if (!response.body)
        throw Error('EMPTY_RESPONSE');
    const reader = response.body.getReader();
    const chunks = [];
    let count = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            count += value.byteLength;
            if (count > LIMIT)
                throw Error('RESPONSE_TOO_LARGE');
            chunks.push(value);
        }
    }
    finally {
        await reader.cancel().catch(() => { });
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function requestFilm(actor, args, env) {
    if (!actor)
        return fail('UNAUTHENTICATED', 'سجل الدخول بحسابك أولاً.');
    if (!record(args) || Object.keys(args).some(k => !['operation', 'input', 'requestId'].includes(k)) || typeof args.operation !== 'string' || !operations.has(args.operation))
        return fail('INVALID_INPUT', 'العملية غير مدعومة.');
    const { operation, input, requestId } = args;
    if (operation.startsWith('admin.') && !actor.isAdmin)
        return fail('FORBIDDEN', 'هذه العملية للمسؤول فقط.');
    try {
        if (!id(requestId) || !validInput(operation, input) || Buffer.byteLength(JSON.stringify(input)) > LIMIT - 4096)
            return fail('INVALID_INPUT', 'راجع الحقول المطلوبة.');
    }
    catch {
        return fail('INVALID_INPUT', 'راجع الحقول المطلوبة.');
    }
    let origin;
    const secret = env.FILM_BRIDGE_SECRET ?? '';
    try {
        origin = new URL(env.FILM_BACKEND_ORIGIN ?? '');
        if (!/^https:\/\/[^/?#\\\s]+\/?$/.test(env.FILM_BACKEND_ORIGIN ?? '') || origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || secret.length < 32 || secret.length > 4096)
            throw Error();
    }
    catch {
        return fail('NOT_CONFIGURED', 'خدمة الأفلام غير مهيأة بعد.');
    }
    const secrets = [secret, env.FILM_BACKEND_ORIGIN ?? '', input.key ?? '', input.tokenId ?? '', input.tokenSecret ?? ''].filter(Boolean);
    const body = JSON.stringify({ requestId, actor, operation, input });
    if (Buffer.byteLength(body) > LIMIT)
        return fail('INVALID_INPUT');
    const timestamp = String(Date.now()), nonce = randomUUID();
    const signature = createHmac('sha256', secret).update(timestamp + '\n' + nonce + '\n' + body).digest('hex');
    const controller = new AbortController();
    let timer;
    try {
        const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('DEADLINE')); }, 25000); });
        // One attempt only. Even a network failure may follow an accepted, billable operation.
        const { data, ok } = await Promise.race([(async () => {
                const response = await fetch(origin.origin + '/api/film-bridge', { method: 'POST', redirect: 'error', signal: controller.signal, headers: { 'content-type': 'application/json', 'x-film-time': timestamp, 'x-film-nonce': nonce, 'x-film-signature': signature }, body });
                const result = await boundedJSON(response);
                if (!response.ok && !record(result))
                    throw Error('HTTP_ERROR');
                if (!response.ok && !result.error)
                    throw Error('HTTP_ERROR');
                return { data: result, ok: response.ok };
            })(), deadline]);
        // A project DTO has its own persisted error display field; that is not an HTTP error envelope.
        if (!ok || (record(data) && data.error && !('id' in data))) {
            if (typeof data.error === 'string' && Object.hasOwn(safeErrors, data.error))
                return fail(data.error, safeErrors[data.error]);
            return fail('REQUEST_STATE_UNKNOWN', 'النتيجة تحتاج متابعة آمنة.', true);
        }
        return operation.startsWith('admin.') ? adminDTO(data, secrets) : projectShape(data, customerShapes[operation], secrets);
    }
    catch {
        return fail('REQUEST_STATE_UNKNOWN', 'تعذر تأكيد نتيجة الطلب.', true);
    }
    finally {
        clearTimeout(timer);
        controller.abort();
    }
}
