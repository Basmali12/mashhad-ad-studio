export function humanChallenge(text:string){
 const t=text.replace(/\s+/g,' ').trim();
 if(/(?:protected by|محميّ?\s+(?:بخدمة|بواسطة)).*recaptcha/i.test(t))return false;
 return /^(?:verify (?:that )?you are (?:a )?human|confirm (?:that )?you(?:'re| are) not a robot|complete (?:the )?(?:captcha|security check)|unusual traffic(?: from| detected)|يرجى (?:إكمال|حل).*(?:التحقق|captcha)|تحقق (?:من أنك إنسان|بشري)|حركة مرور غير معتادة)/i.test(t);
}
