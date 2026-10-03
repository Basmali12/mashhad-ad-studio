export const statuses = ['مسودة', 'بانتظار التشغيل', 'قيد التوليد', 'قيد التنزيل', 'قيد المونتاج', 'قيد الرفع', 'متوقف', 'النتيجة غير محسومة', 'مكتمل', 'فشل', 'يحتاج تسجيل دخول'] as const;
export type RequestStatus = typeof statuses[number];
export const IMAGE_LIMIT = 10 * 1024 * 1024;
// Protected downloads are split into authenticated 8 MB responses.
export const VIDEO_LIMIT = 100 * 1024 * 1024;
export const imageTypes = ['image/png', 'image/jpeg', 'image/webp'];
export type FileKind = 'image' | 'video';
export function validateFile(type: string, size: number, kind: FileKind) {
  if (!(kind === 'image' ? imageTypes.includes(type) : type === 'video/mp4')) throw new Error('نوع الملف غير مسموح؛ الصور PNG/JPG/WebP والفيديو MP4 فقط.');
  if (!Number.isInteger(size) || size <= 0 || size > (kind === 'image' ? IMAGE_LIMIT : VIDEO_LIMIT)) throw new Error(kind === 'image' ? 'حجم الصورة يجب ألا يتجاوز 10 MB.' : 'حجم الفيديو يجب ألا يتجاوز 100 MB.');
}
export function validateSignature(bytes: Uint8Array, type: string) {
  const text = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  const valid = type === 'image/png' ? [137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)
    : type === 'image/jpeg' ? bytes[0]===255 && bytes[1]===216 && bytes[2]===255
    : type === 'image/webp' ? text(0,4)==='RIFF' && text(8,12)==='WEBP'
    : type === 'video/mp4' && text(4,8)==='ftyp' && ['isom','iso2','mp41','mp42','avc1','M4V ','MSNV','dash','iso5','iso6'].some(brand=>text(8,32).includes(brand));
  if (!valid) throw new Error('محتوى الملف لا يطابق نوعه المعلن.');
}
export function validateForm(form: {name:string;address:string;phone:string;products:string;prompt:string;instructions:string;model:string;aspect:string;duration:number;dialect:string}, clipCount: number) {
  for (const [value,limit] of [[form.name,120],[form.address,500],[form.phone,40],[form.products,5000],[form.prompt,10000]] as const) if (!value.trim() || value.length>limit) throw new Error('أكمل الحقول المطلوبة ضمن الطول المسموح.');
  if(form.instructions.length>5000 || !['Omni Flash','Veo 3.1 Fast','Veo 3.1 Quality'].includes(form.model) || !['9:16','16:9'].includes(form.aspect) || !['العراقية','العربية الفصحى','الخليجية','المصرية','الشامية'].includes(form.dialect)) throw new Error('إعدادات الطلب غير صالحة.');
  if(!Number.isInteger(form.duration)||form.duration<1||form.duration>180||!Number.isInteger(clipCount)||clipCount<1||clipCount>60) throw new Error('المدة من 1 إلى 180 ثانية، وعدد المقاطع من 1 إلى 60.');
}
