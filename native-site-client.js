(function(){
  'use strict';

  function one(selector, root){ return (root || document).querySelector(selector); }
  function all(selector, root){ return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }
  function message(text, error){
    var boxes = all('[data-form-message]');
    boxes.forEach(function(box){ box.textContent = text || ''; box.classList.toggle('error', !!error); if(box.classList.contains('floating-message')) box.style.display = text ? 'block' : 'none'; });
  }
  async function request(url, payload){
    document.body.classList.add('busy');
    try{
      var response = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json','Accept':'application/json'}, body:JSON.stringify(payload || {}) });
      var data = await response.json().catch(function(){ return {}; });
      if(!response.ok || data.ok === false){ var error = new Error(data.error || 'That step could not be saved.'); error.data = data; throw error; }
      return data;
    } finally { document.body.classList.remove('busy'); }
  }
  function values(form){
    var data = {};
    new FormData(form).forEach(function(value, key){
      if(value instanceof File) return;
      data[key] = value;
    });
    all('input[type="checkbox"]', form).forEach(function(input){ data[input.name] = input.checked; });
    return data;
  }
  function normalizePhone(value){ return String(value || '').replace(/\D/g, '').slice(-10); }
  function passwordValid(password){ return String(password || '').length >= 8 && /[A-Za-z]/.test(password) && /[0-9]/.test(password); }
  function profileFieldError(form, name, text){
    var input = form.elements[name], error = one('[data-field-error="' + name + '"]', form), label = input && input.closest('label');
    if(error){ error.textContent = text || ''; error.classList.toggle('visible', !!text); }
    if(input){ input.setAttribute('aria-invalid', text ? 'true' : 'false'); }
    if(label) label.classList.toggle('invalid', !!text);
  }
  function validateProfile(form, focusFirst){
    var data = values(form), errors = {}, licenseKey = String(data.driverLicenseId || '').toUpperCase().replace(/[^A-Z0-9]/g, ''), pickupDate = String(data.requestedPickupDate || '').slice(0, 10), expiration = String(data.driverLicenseExpires || '').slice(0, 10);
    if(String(data.address || '').trim().length < 5) errors.address = 'Enter the complete legal street address.';
    if(String(data.city || '').trim().length < 2 || !/[A-Z]/i.test(String(data.city || ''))) errors.city = 'Enter a valid city.';
    if(!/^[A-Z]{2}$/i.test(String(data.state || '').trim())) errors.state = 'Use the two-letter state abbreviation.';
    if(!/^\d{5}(?:-\d{4})?$/.test(String(data.postalCode || '').trim())) errors.postalCode = 'Enter a valid 5-digit or ZIP+4 code.';
    if(licenseKey.length < 5 || licenseKey.length > 24 || /^([A-Z0-9])\1+$/.test(licenseKey)) errors.driverLicenseId = 'Enter the complete number exactly as shown on the license.';
    if(!/^\d{4}-\d{2}-\d{2}$/.test(expiration)) errors.driverLicenseExpires = 'Choose the license expiration date.';
    else if(pickupDate && expiration < pickupDate) errors.driverLicenseExpires = 'The license must remain valid through pickup.';
    if(!pickupDate) errors.requestedPickupDate = 'Choose the requested pickup date.';
    if(!String(data.requestedPickupTime || '')) errors.requestedPickupTime = 'Choose an available pickup time.';
    if(data.pickupAutopayConsent !== true) errors.pickupAutopayConsent = 'Confirm the pickup-day weekly autopay schedule.';
    ['address','city','state','postalCode','driverLicenseId','driverLicenseExpires','requestedPickupDate','requestedPickupTime','pickupAutopayConsent'].forEach(function(name){ profileFieldError(form, name, errors[name] || ''); });
    var names = Object.keys(errors), review = one('[data-profile-review]', form);
    if(review){ review.classList.toggle('invalid', !!names.length); var count = names.length; review.querySelector('strong').textContent = count ? count + ' field' + (count === 1 ? '' : 's') + ' need attention' : 'Profile details look complete'; review.querySelector('span').textContent = count ? 'Correct the highlighted fields before continuing.' : 'Review the details once more, then save and continue.'; }
    var submit = one('button[type="submit"]', form);
    if(submit){ submit.disabled = !!names.length; submit.setAttribute('aria-disabled', names.length ? 'true' : 'false'); }
    if(names.length && focusFirst){ var first = form.elements[names[0]]; if(first){ first.focus({preventScroll:true}); first.scrollIntoView({behavior:'smooth',block:'center'}); } }
    return !names.length;
  }
  function filePayload(file){
    return new Promise(function(resolve, reject){
      if(!file){ reject(new Error('Choose every required document.')); return; }
      if(file.size > 5 * 1024 * 1024){ reject(new Error(file.name + ' is larger than 5 MB.')); return; }
      if(['image/jpeg','image/png','application/pdf'].indexOf(file.type) < 0){ reject(new Error(file.name + ' must be JPG, PNG, or PDF.')); return; }
      var reader = new FileReader();
      reader.onload = function(){ resolve({ name:file.name, type:file.type, size:file.size, dataUrl:String(reader.result || '') }); };
      reader.onerror = function(){ reject(new Error(file.name + ' could not be read.')); };
      reader.readAsDataURL(file);
    });
  }
  function onboardingToken(){ var shell = one('[data-onboarding-token]'); return shell && shell.getAttribute('data-onboarding-token') || ''; }
  function reloadSoon(){ window.setTimeout(function(){ window.location.reload(); }, 450); }
  function setupPickupAvailability(){
    var form = one('form[data-onboarding-form="profile"]');
    if(!form) return;
    var dateInput = form.elements.requestedPickupDate, timeSelect = one('[data-pickup-time]', form), status = one('[data-pickup-availability]', form), sequence = 0;
    if(!dateInput || !timeSelect) return;
    function setStatus(text, error){ if(status){ status.textContent = text || ''; status.classList.toggle('error', !!error); } }
    async function loadSlots(){
      var date = String(dateInput.value || ''), currentSequence = ++sequence;
      if(!date){ timeSelect.disabled = true; timeSelect.value = ''; setStatus('Select a pickup date to see current openings.'); return; }
      timeSelect.disabled = true;
      setStatus('Checking current openings...');
      try{
        var response = await fetch('/api/public/onboarding/' + encodeURIComponent(onboardingToken()) + '/pickup-availability?date=' + encodeURIComponent(date), { headers:{'Accept':'application/json'} });
        var result = await response.json().catch(function(){ return {}; });
        if(currentSequence !== sequence) return;
        if(!response.ok || result.ok === false) throw new Error(result.error || 'Pickup openings could not be loaded.');
        var selected = timeSelect.value, slots = {};
        (result.slots || []).forEach(function(slot){ slots[slot.time] = slot; });
        all('option[value]', timeSelect).forEach(function(option){
          if(!option.value){ option.textContent = 'Choose time'; option.disabled = false; return; }
          var slot = slots[option.value];
          option.disabled = !slot || !slot.available;
          option.textContent = option.value + (!slot || !slot.available ? ' - Full' : slot.remaining === 1 ? ' - 1 opening left' : '');
        });
        if(selected && (!slots[selected] || !slots[selected].available)) timeSelect.value = '';
        timeSelect.disabled = false;
        var availableCount = (result.slots || []).filter(function(slot){ return slot.available; }).length;
        setStatus(availableCount ? availableCount + ' pickup time' + (availableCount === 1 ? '' : 's') + ' available.' : 'No online pickup times remain for this date. Call the office for help.', !availableCount);
        validateProfile(form, false);
      }catch(error){
        if(currentSequence !== sequence) return;
        timeSelect.value = '';
        timeSelect.disabled = true;
        setStatus(error.message, true);
      }
    }
    dateInput.addEventListener('change', loadSlots);
    if(dateInput.value) loadSlots();
  }

  var menu = one('[data-site-menu]');
  if(menu) menu.addEventListener('click', function(){ one('.site-header').classList.toggle('open'); });

  var search = one('[data-inventory-search]');
  if(search){
    search.addEventListener('input', function(){
      var words = search.value.toLowerCase().trim().split(/\s+/).filter(Boolean), shown = 0;
      all('.vehicle-card', one('[data-inventory-grid]')).forEach(function(card){
        var match = !words.length || words.every(function(word){ return card.textContent.toLowerCase().indexOf(word) >= 0; });
        card.style.display = match ? '' : 'none';
        if(match) shown += 1;
      });
      var count = one('[data-inventory-count]'); if(count) count.textContent = shown;
    });
  }

  all('[data-vehicle-gallery]').forEach(function(gallery){
    var track = one('[data-gallery-track]', gallery), slides = all('[data-gallery-slide]', gallery), thumbs = all('[data-gallery-thumb]', gallery), position = one('[data-gallery-position]', gallery);
    if(!track || slides.length < 2) return;
    var active = 0, frame = 0;
    function update(index, move){
      active = Math.max(0, Math.min(slides.length - 1, index));
      thumbs.forEach(function(thumb, thumbIndex){ thumb.classList.toggle('active', thumbIndex === active); });
      if(position) position.textContent = active + 1;
      if(move) track.scrollTo({ left:active * track.clientWidth, behavior:'smooth' });
    }
    thumbs.forEach(function(thumb, index){ thumb.addEventListener('click', function(){ update(index, true); }); });
    var previous = one('[data-gallery-previous]', gallery), next = one('[data-gallery-next]', gallery);
    if(previous) previous.addEventListener('click', function(){ update(active - 1, true); });
    if(next) next.addEventListener('click', function(){ update(active + 1, true); });
    track.addEventListener('scroll', function(){
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(function(){ update(Math.round(track.scrollLeft / Math.max(1, track.clientWidth)), false); });
    }, {passive:true});
  });

  var applicationForm = one('#nativeApplicationForm');
  if(applicationForm){
    applicationForm.addEventListener('submit', async function(event){
      event.preventDefault(); message('');
      var payload = values(applicationForm);
      payload.phone = normalizePhone(payload.phone);
      payload.name = [payload.firstName, payload.lastName].filter(Boolean).join(' ').trim();
      payload.applicationConsent = !!payload.applicationConsent;
      payload.smsConsent = !!payload.smsConsent;
      if(payload.phone.length !== 10){ message('Enter a valid 10-digit mobile phone number.', true); return; }
      if(payload.accountMode !== 'existing' && payload.password !== payload.confirmPassword){ message('The two passwords do not match.', true); return; }
      if(payload.accountMode !== 'existing' && !passwordValid(payload.password)){ message('Password must contain at least eight characters, including a letter and number.', true); return; }
      delete payload.confirmPassword;
      try{
        var result = await request('/api/public/applications', payload);
        var onboardingUrl = String(result.onboardingUrl || '').replace(/[<>\"]/g,'');
        applicationForm.innerHTML = '<div class="form-title"><span>Application received</span><h2>Thank you, ' + String(payload.firstName || '').replace(/[<>]/g,'') + '.</h2><p>Your secure setup is ready. Continue with the pickup request, private screening files, agreement, and no-charge card setup. WheelsonAuto reviews the complete file once. No payment has been charged.</p></div>' + (onboardingUrl ? '<a class="button primary wide" href="' + onboardingUrl + '">Continue secure setup</a>' : '') + '<a class="button secondary wide" href="' + String(result.loginUrl || '/customer/login').replace(/[<>\"]/g,'') + '">Open customer portal</a>';
        window.scrollTo({top:applicationForm.offsetTop - 90, behavior:'smooth'});
      }catch(error){
        if(error.data && /customer_login_required/.test(String(error.data.code || '')) && error.data.loginUrl){ window.location.href = error.data.loginUrl; return; }
        message(error.message, true);
      }
    });
  }

  all('[data-signature-pad]').forEach(function(canvas){
    var context = canvas.getContext('2d'), drawing = false, last = null;
    context.lineWidth = 4; context.lineCap = 'round'; context.strokeStyle = '#151515';
    function point(event){
      var rect = canvas.getBoundingClientRect(), source = event.touches && event.touches[0] || event;
      return { x:(source.clientX - rect.left) * canvas.width / rect.width, y:(source.clientY - rect.top) * canvas.height / rect.height };
    }
    function start(event){ event.preventDefault(); drawing = true; last = point(event); canvas.dataset.signed = '1'; }
    function move(event){ if(!drawing) return; event.preventDefault(); var next = point(event); context.beginPath(); context.moveTo(last.x,last.y); context.lineTo(next.x,next.y); context.stroke(); last = next; }
    function end(){ drawing = false; last = null; var hidden = one('[data-signature-data]', canvas.closest('form')); if(hidden) hidden.value = canvas.toDataURL('image/png'); }
    canvas.addEventListener('pointerdown', start); canvas.addEventListener('pointermove', move); window.addEventListener('pointerup', end);
    canvas.addEventListener('touchstart', start, {passive:false}); canvas.addEventListener('touchmove', move, {passive:false}); canvas.addEventListener('touchend', end);
    var clear = one('[data-clear-signature]', canvas.parentNode);
    if(clear) clear.addEventListener('click', function(){ context.clearRect(0,0,canvas.width,canvas.height); canvas.dataset.signed=''; var hidden=one('[data-signature-data]',canvas.closest('form')); if(hidden) hidden.value=''; });
  });

  var activeCameraStop = null;
  all('[data-live-document-capture]').forEach(function(shell){
    var video = one('[data-camera-video]', shell), canvas = one('[data-camera-canvas]', shell), preview = one('[data-camera-preview]', shell), placeholder = one('[data-camera-placeholder]', shell), hidden = one('[data-live-document]', shell), openButton = one('[data-camera-open]', shell), takeButton = one('[data-camera-take]', shell), retakeButton = one('[data-camera-retake]', shell), errorBox = one('[data-camera-error]', shell), statusBox = one('[data-camera-status]', shell), browserHelp = one('[data-camera-browser-help]', shell), shareButton = one('[data-camera-share]', shell), copyButton = one('[data-camera-copy]', shell), documentKind = String(shell.getAttribute('data-document-kind') || ''), facingMode = String(shell.getAttribute('data-camera-facing') || 'environment'), stream = null, analysisTimer = null, analysisBusy = false, stableFrames = 0;
    function setStatus(text, ready){ if(statusBox){ statusBox.textContent = text || ''; statusBox.classList.toggle('ready', !!ready); } }
    function stopCamera(){ if(analysisTimer) window.clearInterval(analysisTimer); analysisTimer = null; if(stream) stream.getTracks().forEach(function(track){ track.stop(); }); stream = null; analysisBusy = false; stableFrames = 0; if(activeCameraStop === stopCamera) activeCameraStop = null; }
    function showError(text, offerBrowserHelp){ errorBox.textContent = text; errorBox.hidden = !text; if(browserHelp) browserHelp.hidden = !offerBrowserHelp; }
    function cameraErrorMessage(error){
      var name = String(error && error.name || '');
      if(name === 'NotAllowedError' || name === 'SecurityError') return 'Camera access is blocked in this browser. Open this saved setup in Safari, Chrome, or Edge and allow camera access.';
      if(name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No camera was found on this device. Continue this saved setup on a phone or computer with a camera.';
      if(name === 'NotReadableError' || name === 'TrackStartError') return 'The camera is busy or unavailable. Close other apps using the camera, then try again.';
      if(name === 'AbortError') return 'Camera startup was interrupted. Try again, or continue this saved setup in Safari, Chrome, or Edge.';
      return 'This browser could not start the secure live camera. Continue this saved setup in Safari, Chrome, or Edge.';
    }
    async function cameraStream(){
      try{ return await navigator.mediaDevices.getUserMedia({ video:{ facingMode:{ideal:facingMode}, width:{ideal:1080}, height:{ideal:1440} }, audio:false }); }
      catch(error){
        var name = String(error && error.name || '');
        if(name !== 'OverconstrainedError' && name !== 'ConstraintNotSatisfiedError') throw error;
        return navigator.mediaDevices.getUserMedia({ video:true, audio:false });
      }
    }
    async function copySecureLink(){
      try{
        if(!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(window.location.href);
        showError('Secure link copied. Paste it into Safari, Chrome, or Edge on a camera-enabled device.', true);
      }catch(error){ showError('Copy this page address from the browser and open it in Safari, Chrome, or Edge. Your progress is saved.', true); }
    }
    async function shareSecureLink(){
      if(navigator.share){
        try{ await navigator.share({ title:'Continue WheelsonAuto verification', url:window.location.href }); return; }
        catch(error){ if(String(error && error.name || '') === 'AbortError') return; }
      }
      await copySecureLink();
    }
    async function openCamera(){
      showError('', false);
      if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ showError('This browser does not expose a secure live camera. Continue this saved setup in Safari, Chrome, or Edge.', true); return; }
      try{
        if(activeCameraStop && activeCameraStop !== stopCamera) activeCameraStop();
        stopCamera();
        stream = await cameraStream();
        video.srcObject = stream; await video.play();
        video.hidden = false; placeholder.hidden = true; preview.hidden = true; openButton.hidden = true; takeButton.hidden = false; retakeButton.hidden = true;
        activeCameraStop = stopCamera;
        setStatus(documentKind === 'identity_selfie' ? 'Center your face and hold the license directly below your chin.' : 'Fit all four license corners inside the guide. Hold still.', false);
        analysisTimer = window.setInterval(analyzeFrame, 450);
      }catch(error){ stopCamera(); showError(cameraErrorMessage(error), true); }
    }
    function frameQuality(){
      var width = 180, height = Math.max(120, Math.round(width * video.videoHeight / video.videoWidth)), qualityCanvas = document.createElement('canvas');
      qualityCanvas.width = width; qualityCanvas.height = height;
      var context = qualityCanvas.getContext('2d', {willReadFrequently:true});
      context.drawImage(video, 0, 0, width, height);
      var pixels = context.getImageData(0, 0, width, height).data, light = 0, edge = 0, samples = 0;
      function luminanceAt(x,y){ var index=(Math.max(0,Math.min(height-1,y))*width+Math.max(0,Math.min(width-1,x)))*4; return pixels[index]*.299+pixels[index+1]*.587+pixels[index+2]*.114; }
      for(var y=4;y<height-4;y+=4){ for(var x=4;x<width-4;x+=4){ var index=(y*width+x)*4, previous=(y*width+x-4)*4, value=(pixels[index]*.299+pixels[index+1]*.587+pixels[index+2]*.114), old=(pixels[previous]*.299+pixels[previous+1]*.587+pixels[previous+2]*.114); light+=value; edge+=Math.abs(value-old); samples+=1; } }
      var guide = documentKind === 'identity_selfie' ? {left:.17,right:.83,top:.63,bottom:.91} : {left:.08,right:.92,top:.2,bottom:.8}, left=Math.round(width*guide.left), right=Math.round(width*guide.right), top=Math.round(height*guide.top), bottom=Math.round(height*guide.bottom), documentEdge=0, boundarySamples=0;
      for(var boundaryY=top+4;boundaryY<bottom-4;boundaryY+=4){ documentEdge+=Math.abs(luminanceAt(left-3,boundaryY)-luminanceAt(left+3,boundaryY))+Math.abs(luminanceAt(right-3,boundaryY)-luminanceAt(right+3,boundaryY));boundarySamples+=2; }
      for(var boundaryX=left+4;boundaryX<right-4;boundaryX+=4){ documentEdge+=Math.abs(luminanceAt(boundaryX,top-3)-luminanceAt(boundaryX,top+3))+Math.abs(luminanceAt(boundaryX,bottom-3)-luminanceAt(boundaryX,bottom+3));boundarySamples+=2; }
      return { light:samples?light/samples:0, edge:samples?edge/samples:0, documentEdge:boundarySamples?documentEdge/boundarySamples:0 };
    }
    async function visibleFaceReady(){
      if(documentKind !== 'identity_selfie' || typeof window.FaceDetector !== 'function') return true;
      try{ var faces = await new window.FaceDetector({fastMode:true,maxDetectedFaces:2}).detect(video); if(faces.length !== 1) return false; var box=faces[0].boundingBox; return box.width >= video.videoWidth*.2 && box.height >= video.videoHeight*.2; }
      catch(error){ return true; }
    }
    async function analyzeFrame(){
      if(analysisBusy || !stream || hidden.value || !video.videoWidth) return;
      analysisBusy = true;
      try{
        var quality = frameQuality(), faceReady = await visibleFaceReady(), documentReady = quality.documentEdge >= 4, clear = quality.light >= 45 && quality.light <= 225 && quality.edge >= 5 && faceReady && documentReady;
        stableFrames = clear ? stableFrames + 1 : 0;
        if(!faceReady) setStatus('Keep one face centered inside the oval.', false);
        else if(quality.light < 45) setStatus('Move to brighter, even lighting.', false);
        else if(quality.light > 225) setStatus('Reduce glare and direct light on the license.', false);
        else if(quality.edge < 5) setStatus('Move closer and hold the camera steady so the details are sharp.', false);
        else if(!documentReady) setStatus('Line up all four license edges inside the rectangular guide.', false);
        else if(stableFrames < 4) setStatus('Good position. Hold still ' + (4-stableFrames) + '...', true);
        if(stableFrames >= 4) takePhoto(true);
      } finally { analysisBusy = false; }
    }
    function takePhoto(automatic){
      if(!stream || !video.videoWidth || !video.videoHeight){ showError('The camera is not ready yet. Hold still and try again.'); return; }
      var width = Math.min(1080, video.videoWidth), height = Math.round(width * video.videoHeight / video.videoWidth);
      canvas.width = width; canvas.height = height; canvas.getContext('2d').drawImage(video, 0, 0, width, height);
      hidden.value = canvas.toDataURL('image/jpeg', 0.92); hidden.dataset.capturedAt = new Date().toISOString(); hidden.dataset.cameraFacingMode = facingMode; preview.src = hidden.value; preview.hidden = false; video.hidden = true; takeButton.hidden = true; retakeButton.hidden = false; setStatus(automatic ? 'Captured automatically. Review the photo before submitting.' : 'Photo captured. Review it before submitting.', true); stopCamera();
    }
    openButton.addEventListener('click', openCamera); takeButton.addEventListener('click', function(){ takePhoto(false); }); retakeButton.addEventListener('click', function(){ hidden.value = ''; hidden.dataset.capturedAt=''; openCamera(); });
    if(shareButton) shareButton.addEventListener('click', shareSecureLink);
    if(copyButton) copyButton.addEventListener('click', copySecureLink);
    window.addEventListener('pagehide', stopCamera, {once:true});
  });

  all('form[data-onboarding-form]').forEach(function(form){
    if(form.getAttribute('data-onboarding-form') === 'profile'){
      all('input,select', form).forEach(function(input){
        input.addEventListener(input.type === 'checkbox' || input.tagName === 'SELECT' ? 'change' : 'input', function(){ validateProfile(form, false); });
      });
      validateProfile(form, false);
    }
    form.addEventListener('submit', async function(event){
      event.preventDefault(); message('');
      var token = onboardingToken(), kind = form.getAttribute('data-onboarding-form'), payload = values(form), url = '/api/public/onboarding/' + encodeURIComponent(token) + '/' + kind;
      try{
        if(kind === 'profile' && !validateProfile(form, true)) throw new Error('Correct the highlighted profile fields before continuing.');
        if(kind === 'documents'){
          var liveDocuments = all('[data-live-document]', form);
          payload.documents = liveDocuments.map(function(input){
            var documentKind = String(input.getAttribute('data-document-kind') || input.name || '');
            if(!input.value) throw new Error(documentKind === 'identity_selfie' ? 'Take the live selfie while holding your license below your chin.' : 'Take a live photo of the ' + (documentKind === 'driver_license_front' ? 'front' : 'back') + ' of your license.');
            delete payload[documentKind];
            return { name:documentKind + '-live.jpg', type:'image/jpeg', dataUrl:input.value, kind:documentKind, captureSource:'live_camera', capturedAt:input.dataset.capturedAt || new Date().toISOString(), cameraFacingMode:input.dataset.cameraFacingMode || (documentKind === 'identity_selfie' ? 'user' : 'environment') };
          });
        }
        if(kind === 'insurance' && payload.insuranceOption === 'upload'){
          var insuranceInput = one('input[name="insurance"]', form);
          var insuranceDocument = await filePayload(insuranceInput && insuranceInput.files && insuranceInput.files[0]);
          insuranceDocument.kind = 'insurance';
          payload.documents = [insuranceDocument];
        }
        if(kind === 'signature'){
          var canvas = one('[data-signature-pad]', form), hidden = one('[data-signature-data]', form);
          if(!canvas || canvas.dataset.signed !== '1' || !hidden.value){ throw new Error('Draw your complete signature before signing.'); }
          payload.signatureData = hidden.value;
        }
        var result = await request(url, payload);
        if(result.redirectUrl){ window.location.href = result.redirectUrl; return; }
        message(result.message || 'Saved securely.'); reloadSoon();
      }catch(error){ message(error.message, true); }
    });
  });
  setupPickupAvailability();
})();
