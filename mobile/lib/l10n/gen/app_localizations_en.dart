// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appName => 'MedPin';

  @override
  String get appTagline => 'Diabetes care with Dr. Amit Kumar Dey';

  @override
  String get commonRetry => 'Retry';

  @override
  String get commonCancel => 'Cancel';

  @override
  String get commonSave => 'Save';

  @override
  String get commonSubmit => 'Submit';

  @override
  String get commonLoading => 'Loading…';

  @override
  String get commonOk => 'OK';

  @override
  String get commonClose => 'Close';

  @override
  String get commonDelete => 'Delete';

  @override
  String get commonEdit => 'Edit';

  @override
  String get commonYes => 'Yes';

  @override
  String get commonNo => 'No';

  @override
  String get commonSomethingWentWrong => 'Something went wrong';

  @override
  String get commonNoInternet =>
      'No internet connection. Please check your network.';

  @override
  String get commonTryAgain => 'Try again';

  @override
  String get commonComingSoon => 'Coming next';

  @override
  String get commonComingSoonBody =>
      'This section is being built and will be available in a future update.';

  @override
  String get commonRequiredField => 'This field is required';

  @override
  String get commonUnknownError => 'An unexpected error occurred';

  @override
  String get languagePickerTitle => 'Choose your language';

  @override
  String get languagePickerSubtitle =>
      'You can change this anytime from your profile.';

  @override
  String get languageEnglish => 'English';

  @override
  String get languageBengali => 'বাংলা';

  @override
  String get languageHindi => 'हिन्दी';

  @override
  String get continueButton => 'Continue';

  @override
  String get authLoginTitle => 'Welcome back';

  @override
  String get authLoginSubtitle => 'Log in to manage your diabetes care.';

  @override
  String get authRegisterTitle => 'Create your account';

  @override
  String get authRegisterSubtitle =>
      'Tell us a little about yourself to get started.';

  @override
  String get authPhoneLabel => 'Phone number';

  @override
  String get authPhoneHint => 'Enter your 10-digit number';

  @override
  String get authPasswordHint => 'Enter your password';

  @override
  String get authPasswordLabel => 'Password';

  @override
  String get authNameLabel => 'Full name';

  @override
  String get authEmailLabel => 'Email (optional)';

  @override
  String get authDateOfBirthLabel => 'Date of birth';

  @override
  String get authGenderLabel => 'Gender';

  @override
  String get authGenderMale => 'Male';

  @override
  String get authGenderFemale => 'Female';

  @override
  String get authGenderOther => 'Other';

  @override
  String get authDiabetesTypeLabel => 'Diabetes type';

  @override
  String get authDiabetesType1 => 'Type 1';

  @override
  String get authDiabetesType2 => 'Type 2';

  @override
  String get authDiabetesTypeGestational => 'Gestational';

  @override
  String get authDiabetesTypePrediabetes => 'Prediabetes';

  @override
  String get authLoginButton => 'Log in';

  @override
  String get authRegisterButton => 'Create account';

  @override
  String get authNoAccount => 'Don\'t have an account?';

  @override
  String get authHaveAccount => 'Already have an account?';

  @override
  String get authGoToRegister => 'Register';

  @override
  String get authGoToLogin => 'Log in';

  @override
  String get authInvalidCredentials => 'Incorrect phone number or password';

  @override
  String get authPasswordTooShort => 'Password must be at least 8 characters';

  @override
  String get authPasswordHelper => 'At least 8 characters';

  @override
  String get authNameTooShort => 'Please enter your full name';

  @override
  String get authInvalidPhone => 'Enter a valid 10-digit mobile number';

  @override
  String get authInvalidEmail =>
      'Enter a valid email address, or leave it blank';

  @override
  String get authPasswordRequired => 'Please enter your password';

  @override
  String get authPasswordTooLong => 'Password must be 128 characters or fewer';

  @override
  String get authConfirmPasswordLabel => 'Confirm password';

  @override
  String get authPasswordMismatch => 'Passwords do not match';

  @override
  String get authNameTooLong => 'Name must be 120 characters or fewer';

  @override
  String get authDateOfBirthRequired => 'Please select your date of birth';

  @override
  String get authDateOfBirthTooYoung =>
      'Date of birth must be at least 1 year ago';

  @override
  String get authGenderRequired => 'Please select an option';

  @override
  String get authDiabetesTypeRequired => 'Please select your diabetes type';

  @override
  String get authDiabetesTypeNone => 'None / not diabetic';

  @override
  String get authDiabetesTypeHelper => 'Ask your doctor if you are not sure';

  @override
  String get authLogoutConfirmTitle => 'Log out?';

  @override
  String get authLogoutConfirmBody =>
      'You will need to log in again to access your care details.';

  @override
  String get navHome => 'Home';

  @override
  String get navChat => 'Chat';

  @override
  String get navTrack => 'Track';

  @override
  String get navCare => 'Care';

  @override
  String get navProfile => 'Profile';

  @override
  String dashboardGreetingMorning(String name) {
    return 'Good morning, $name';
  }

  @override
  String dashboardGreetingAfternoon(String name) {
    return 'Good afternoon, $name';
  }

  @override
  String dashboardGreetingEvening(String name) {
    return 'Good evening, $name';
  }

  @override
  String get dashboardHealthScore => 'Health score';

  @override
  String dashboardHealthScoreBand(String band) {
    return '$band';
  }

  @override
  String get dashboardGlucoseLatest => 'Latest glucose';

  @override
  String get dashboardGlucoseAverage => '7-day average';

  @override
  String get dashboardTimeInRange => 'Time in range';

  @override
  String get dashboardAdherence => 'Medicine adherence';

  @override
  String dashboardTodayPending(int count) {
    return '$count due today';
  }

  @override
  String get dashboardNextAppointment => 'Next appointment';

  @override
  String get dashboardAppointmentRequested => 'Appointment requested';

  @override
  String get dashboardWaitingForClinic =>
      'Waiting for the clinic to confirm a time';

  @override
  String get dashboardAwaitingTime => 'The clinic will confirm a day and time';

  @override
  String get dashboardNoAppointment => 'No upcoming appointment';

  @override
  String get dashboardOpenAlerts => 'Open alerts';

  @override
  String get dashboardNoAlerts => 'No open alerts';

  @override
  String get dashboardRecommendations => 'Recommendations for you';

  @override
  String get dashboardNoRecommendations => 'You\'re all caught up';

  @override
  String get dashboardFootScreeningDue => 'Foot screening due';

  @override
  String get dashboardEyeScreeningDue => 'Eye screening due';

  @override
  String get dashboardHba1cDue => 'HbA1c test due';

  @override
  String get dashboardEmptyTitle => 'No dashboard data yet';

  @override
  String get dashboardEmptyBody =>
      'Start logging your glucose and medicines to see your health summary here.';

  @override
  String get dashboardErrorTitle => 'Couldn\'t load your dashboard';

  @override
  String get chatTitle => 'Dr. Dey\'s Clinic';

  @override
  String get chatFromClinic => 'From the clinic';

  @override
  String get appLockSubtitle =>
      'Unlock to see your messages and health records.';

  @override
  String get profileFeedback => 'Send feedback';

  @override
  String get profileFeedbackSub => 'About the clinic or this app';

  @override
  String get chatTapToStop => 'TAP TO STOP';

  @override
  String get chatRecordVoice => 'Record a voice message';

  @override
  String get chatVoiceSending => 'Sending your voice message…';

  @override
  String get chatVoiceFailed =>
      'Could not send your voice message. Please try again.';

  @override
  String get chatVoiceUnclear =>
      'I could not make out the recording. Please try again, or type your message.';

  @override
  String get chatReply => 'Reply';

  @override
  String get chatPin => 'Pin to top';

  @override
  String get chatUnpin => 'Unpin';

  @override
  String get chatHide => 'Hide for me';

  @override
  String get chatHideNote =>
      'Stays in your medical record; only removed from your view';

  @override
  String get chatDeleteForEveryone => 'Delete for everyone';

  @override
  String get chatDeletedForEveryone => 'This message was deleted';

  @override
  String get chatDeleteForEveryoneConfirm =>
      'This message will be removed for everyone in the chat. This can\'t be undone.';

  @override
  String get chatPinned => 'Pinned';

  @override
  String get chatSeenByClinic => 'Seen by the clinic';

  @override
  String get chatReplyingTo => 'Replying to';

  @override
  String get chatCannotHideEmergency =>
      'This is part of an emergency record and cannot be hidden';

  @override
  String get chatReplyToPatient => 'Reply to this patient…';

  @override
  String get chatReplySent => 'Sent to the patient';

  @override
  String get chatComposerHint => 'Ask about your health…';

  @override
  String get chatSend => 'Send';

  @override
  String get chatSessions => 'Chat history';

  @override
  String get chatSessionsEmpty => 'No previous chats yet';

  @override
  String get chatDisclaimer => 'AI-assisted guidance, not a diagnosis';

  @override
  String get chatThinking => 'MedPin Assistant is typing…';

  @override
  String get chatEmergencyTitle => 'Emergency — act now';

  @override
  String get chatEmergencyBody => 'Go to the nearest hospital immediately';

  @override
  String get chatCallClinic => 'Call clinic';

  @override
  String get chatUrgentTitle => 'Needs prompt attention';

  @override
  String get chatCitations => 'Sources';

  @override
  String get chatFlagMessage => 'Report this answer';

  @override
  String get chatFlagSent =>
      'Thank you, this reply has been reported for review.';

  @override
  String get chatWelcomeTitle => 'Hello, I\'m your MedPin Assistant';

  @override
  String get chatWelcomeBody =>
      'Ask me about your glucose readings, medicines, diet, or any diabetes-related question. In an emergency, always call the clinic or go to the nearest hospital.';

  @override
  String get chatEmptyInput => 'Type a message before sending';

  @override
  String get chatArchiveSession => 'Archive';

  @override
  String get chatArchived => 'Chat archived';

  @override
  String get chatAnalyzing => 'MedPin is analyzing data…';

  @override
  String get chatAttach => 'Attach a photo';

  @override
  String get chatAttachCamera => 'Take a photo';

  @override
  String get chatAttachGallery => 'Choose from gallery';

  @override
  String get chatAttachRemove => 'Remove attachment';

  @override
  String get chatAttachUploading => 'Uploading…';

  @override
  String get chatAttachFailed =>
      'Could not upload that photo. Please try again.';

  @override
  String get chatAttachTooLarge =>
      'That photo is too large. Please choose one under 12 MB.';

  @override
  String get chatAttachLimit => 'You can attach up to 5 photos.';

  @override
  String get chatAttachNeedsText =>
      'Add a short note describing the photo before sending.';

  @override
  String get chatEmptyTitle => 'How can I help today?';

  @override
  String get chatEmptyBody =>
      'Ask about your blood sugar, diet, medicines or symptoms. Available 24/7.';

  @override
  String get chatSuggestionSugar =>
      'My blood sugar is high today — what should I do?';

  @override
  String get chatSuggestionDiet => 'What are some healthy breakfast ideas?';

  @override
  String get chatSuggestionFeet =>
      'My feet feel numb and tingly. Should I worry?';

  @override
  String get chatSuggestionEye => 'Help me understand my eye report';

  @override
  String get chatCopy => 'Copy';

  @override
  String get chatCopied => 'Copied to clipboard';

  @override
  String get chatRetry => 'Try again';

  @override
  String get chatScrollToLatest => 'Jump to latest';

  @override
  String get chatDateToday => 'Today';

  @override
  String get chatDateYesterday => 'Yesterday';

  @override
  String get voiceListening => 'Listening…';

  @override
  String get voiceTapToSpeak => 'Speak to the assistant';

  @override
  String get voiceDone => 'Done';

  @override
  String get voiceCancel => 'Cancel';

  @override
  String get voiceNoSpeech => 'I didn\'t catch that — try again';

  @override
  String get voicePermissionTitle => 'Microphone access is needed';

  @override
  String get voicePermissionBody =>
      'Allow microphone access so you can speak instead of typing.';

  @override
  String get voiceOpenSettings => 'Open settings';

  @override
  String get voiceUnavailable => 'Voice input isn\'t available on this device';

  @override
  String get voiceSlideToCancel => 'Slide to cancel';

  @override
  String get voiceSlideToLock => 'Slide up to lock, hands-free';

  @override
  String get voiceReleaseToCancel => 'Release to cancel';

  @override
  String get voiceRecording => 'Recording';

  @override
  String get voiceReviewBeforeSending => 'Check the text before sending';

  @override
  String get glucoseTitle => 'Glucose';

  @override
  String get glucoseLogReading => 'Log a reading';

  @override
  String get glucoseValueLabel => 'Blood glucose (mg/dL)';

  @override
  String get glucoseContextLabel => 'When was this taken?';

  @override
  String get glucoseContextFasting => 'Fasting';

  @override
  String get glucoseContextPreMeal => 'Before meal';

  @override
  String get glucoseContextPostMeal => 'After meal';

  @override
  String get glucoseContextBedtime => 'Bedtime';

  @override
  String get glucoseContextRandom => 'Random';

  @override
  String get glucoseTimeLabel => 'Date & time';

  @override
  String get glucoseNotesLabel => 'Notes (optional)';

  @override
  String get glucoseSaveReading => 'Save reading';

  @override
  String get glucoseReadingSaved => 'Reading saved';

  @override
  String get glucoseTrend => '30-day trend';

  @override
  String get glucoseTargetRange => 'Target range';

  @override
  String get glucoseRecentReadings => 'Recent readings';

  @override
  String get glucoseEmptyTitle => 'No readings yet';

  @override
  String get glucoseEmptyBody =>
      'Log your first blood glucose reading to start tracking your trend.';

  @override
  String get glucoseFlagSevereLow => 'Severe low';

  @override
  String get glucoseFlagLow => 'Low';

  @override
  String get glucoseFlagInRange => 'In range';

  @override
  String get glucoseFlagVeryHigh => 'Very high';

  @override
  String get glucoseFlagCriticalHigh => 'Critical high';

  @override
  String get glucoseDeleteConfirm => 'Delete this reading?';

  @override
  String get glucoseStatsAverage => 'Average';

  @override
  String get glucoseStatsMin => 'Lowest';

  @override
  String get glucoseStatsMax => 'Highest';

  @override
  String get glucoseStatsHba1c => 'Estimated HbA1c';

  @override
  String get medsTitle => 'Medications';

  @override
  String get medsTodaySchedule => 'Today\'s schedule';

  @override
  String get medsAdherence => 'Adherence';

  @override
  String get medsMarkTaken => 'Mark taken';

  @override
  String get medsMarkSkipped => 'Mark skipped';

  @override
  String get medsStatusTaken => 'Taken';

  @override
  String get medsStatusSkipped => 'Skipped';

  @override
  String get medsStatusPending => 'Pending';

  @override
  String get medsStatusMissed => 'Missed';

  @override
  String get medsEmptyTitle => 'No medicines scheduled today';

  @override
  String get medsEmptyBody =>
      'Your doctor hasn\'t added any medicines for today.';

  @override
  String get medsRelationBeforeMeal => 'Before meal';

  @override
  String get medsRelationAfterMeal => 'After meal';

  @override
  String get medsRelationWithMeal => 'With meal';

  @override
  String get medsRelationAnytime => 'Anytime';

  @override
  String get medsSkipReasonTitle => 'Why are you skipping this dose?';

  @override
  String get medsLast30Days => 'Last 30 days';

  @override
  String get careTitle => 'Care';

  @override
  String get careFootCare => 'Foot Care';

  @override
  String get careFootCareDesc => 'Track wound checks and foot health';

  @override
  String get careEyeCare => 'Eye Care';

  @override
  String get careEyeCareDesc => 'Retinal screening reports and guidance';

  @override
  String get careAppointments => 'Appointments';

  @override
  String get careAppointmentsDesc => 'Book and manage clinic visits';

  @override
  String get carePrescriptions => 'Prescriptions';

  @override
  String get carePrescriptionsDesc => 'View prescriptions from your doctor';

  @override
  String get careLabReports => 'Lab Reports';

  @override
  String get careLabReportsDesc => 'Your lab test results';

  @override
  String get profileTitle => 'Profile';

  @override
  String get profileLanguage => 'Language';

  @override
  String get profileLogout => 'Log out';

  @override
  String get profileEditProfile => 'Edit profile';

  @override
  String get profileAbout => 'About MedPin';

  @override
  String get profilePatient => 'Patient';

  @override
  String get profileAppearance => 'Appearance';

  @override
  String get profileThemeLight => 'Light';

  @override
  String get profileThemeDark => 'Dark';

  @override
  String get profileThemeSystem => 'System';

  @override
  String get profileAccount => 'Account';

  @override
  String get profileClinic => 'Clinic';

  @override
  String get profileSupport => 'Support';

  @override
  String get profileDiabetesType => 'Diabetes type';

  @override
  String get profileDiabetesTypeNotSet => 'Not set';

  @override
  String get profileNotifications => 'Notifications';

  @override
  String get profileCallClinic => 'Call clinic';

  @override
  String get profileFooter => 'Carefully made for your wellbeing';

  @override
  String get profileSave => 'Save';

  @override
  String get profileSaved => 'Your details have been updated';

  @override
  String get profilePhoneLocked =>
      'Your phone number is your login and cannot be changed here. Please contact the clinic if it needs updating.';

  @override
  String get profileChangePhoto => 'Change photo';

  @override
  String get profileDiabetesSheetTitle => 'Your diabetes type';

  @override
  String get profileDiabetesSheetBody =>
      'This helps the assistant give you the right guidance. Ask your doctor if you are not sure.';

  @override
  String get profileDiabetesType1Desc => 'The body makes no insulin';

  @override
  String get profileDiabetesType2Desc => 'Insulin is not used well';

  @override
  String get profileDiabetesGestationalDesc => 'Occurs during pregnancy';

  @override
  String get profileDiabetesPrediabetesDesc =>
      'Glucose above normal, below diabetes';

  @override
  String get profileDiabetesNoneDesc => 'Not diabetic';

  @override
  String get profileNotificationsBody =>
      'Alerts from the clinic are not yet delivered to this device. Your doctor still sees every alert you raise.';

  @override
  String get profilePreferences => 'Preferences';

  @override
  String get profileSecurity => 'Security';

  @override
  String get profileHealthDetails => 'Health details';

  @override
  String get profileGlucoseUnit => 'Glucose unit';

  @override
  String get profileAppLock => 'App lock';

  @override
  String get profileAppLockSub =>
      'Require your fingerprint, face or device PIN to open the app';

  @override
  String get notifMedicationReminders => 'Medication reminders';

  @override
  String get notifMedicationRemindersSub => 'Nudge me when a dose is due';

  @override
  String get notifAppointmentAlerts => 'Appointment reminders';

  @override
  String get notifAppointmentAlertsSub => 'Remind me before a visit';

  @override
  String get notifClinicAlerts => 'Clinic messages';

  @override
  String get notifClinicAlertsSub => 'Replies and follow-ups from the clinic';

  @override
  String get notifDeliveryNote =>
      'Your notification settings are saved and will apply as soon as alerts start arriving on this phone. Your doctor already sees everything you raise.';

  @override
  String get healthHeight => 'Height (cm)';

  @override
  String get healthWeight => 'Weight (kg)';

  @override
  String get healthDiagnosedOn => 'Diagnosed on';

  @override
  String get healthAllergies => 'Allergies';

  @override
  String get healthAllergiesHint => 'e.g. Penicillin, Sulfa';

  @override
  String get healthMainConcern => 'Main concern';

  @override
  String get healthMainConcernHint => 'What\'s troubling you most right now';

  @override
  String get healthEmergencyContact => 'Emergency contact';

  @override
  String get healthContactName => 'Contact name';

  @override
  String get healthContactPhone => 'Contact phone';

  @override
  String get healthContactRelation => 'Relationship';

  @override
  String get healthNotSet => 'Not set';

  @override
  String get appLockEnable => 'Unlock with fingerprint or face';

  @override
  String get appLockUnavailable =>
      'This device has no fingerprint or face unlock set up.';

  @override
  String get appLockPrompt => 'Unlock MedPin';

  @override
  String get appLockLocked => 'MedPin is locked';

  @override
  String get appLockUnlock => 'Unlock';

  @override
  String get apptTitle => 'Appointments';

  @override
  String get apptBook => 'Book appointment';

  @override
  String get apptUpcoming => 'Upcoming';

  @override
  String get apptPast => 'Past';

  @override
  String get apptNoUpcoming => 'No upcoming appointments';

  @override
  String get apptNoUpcomingBody =>
      'Book a visit with the clinic and it will appear here.';

  @override
  String get apptNoPast => 'No past appointments';

  @override
  String get apptChooseClinic => 'Choose a clinic';

  @override
  String get apptChooseDate => 'Choose a date';

  @override
  String get apptChooseTime => 'Choose a time';

  @override
  String get apptNoSlots => 'No available times on this day';

  @override
  String get apptClosedThatDay => 'The clinic is closed on this day';

  @override
  String get apptNotifyMeLater => 'Notify me if a slot opens';

  @override
  String get apptWaitlistJoined => 'We\'ll notify you if a slot opens';

  @override
  String get apptReasonLabel => 'Reason for visit (optional)';

  @override
  String get apptReasonHint => 'e.g. Follow-up, sugar review';

  @override
  String get apptConfirmBooking => 'Confirm booking';

  @override
  String get apptBookedTitle => 'Appointment confirmed';

  @override
  String get apptBookedBody =>
      'Your appointment is confirmed. You\'ll find it under Upcoming.';

  @override
  String get apptCancel => 'Cancel appointment';

  @override
  String get apptCancelConfirm => 'Cancel this appointment?';

  @override
  String get apptCancelConfirmBody =>
      'The time slot will be released for others.';

  @override
  String get apptCancelled => 'Appointment cancelled';

  @override
  String get apptReschedule => 'Reschedule';

  @override
  String get apptCall => 'Call clinic';

  @override
  String get apptDirections => 'Directions';

  @override
  String get apptStatusRequested => 'Requested';

  @override
  String get apptStatusConfirmed => 'Confirmed';

  @override
  String get apptStatusCheckedIn => 'Checked in';

  @override
  String get apptStatusInConsultation => 'In consultation';

  @override
  String get apptStatusCompleted => 'Completed';

  @override
  String get apptStatusCancelled => 'Cancelled';

  @override
  String get apptStatusNoShow => 'Missed';

  @override
  String get apptModeInClinic => 'In clinic';

  @override
  String get apptModeTeleconsult => 'Video consult';

  @override
  String get apptSlotTaken => 'That time was just taken. Please pick another.';

  @override
  String get apptBookingFailed => 'Could not book. Please try again.';

  @override
  String get apptSelectSlotFirst => 'Please choose a time first';

  @override
  String get msgClinicTitle => 'Message the clinic';

  @override
  String get msgComposerHint => 'Write a message…';

  @override
  String get msgEmpty => 'No messages yet';

  @override
  String get msgEmptyBody =>
      'Send a message and the clinic team will reply here.';

  @override
  String get msgEmptyClinician => 'Send a message to start the conversation.';

  @override
  String get careMessageClinic => 'Message the clinic';

  @override
  String get careMessageClinicDesc => 'Chat directly with the clinic team';

  @override
  String get callStart => 'Call';

  @override
  String get callVideo => 'Video call';

  @override
  String get callVoice => 'Voice call';

  @override
  String get callFailed => 'Could not start the call. Please try again.';

  @override
  String get apptToday => 'Today';

  @override
  String get apptTomorrow => 'Tomorrow';

  @override
  String apptWithDoctor(String doctor) {
    return 'with $doctor';
  }

  @override
  String get errorBadRequest => 'That request could not be understood.';

  @override
  String get errorValidation => 'Please check the details you entered.';

  @override
  String get errorUnauthorized =>
      'Your session has expired. Please log in again.';

  @override
  String get errorForbidden => 'You don\'t have permission to do that.';

  @override
  String get errorNotFound => 'We couldn\'t find what you\'re looking for.';

  @override
  String get errorConflict => 'This conflicts with existing data.';

  @override
  String get errorDuplicate => 'This already exists.';

  @override
  String get errorRateLimited =>
      'Too many attempts. Please wait a moment and try again.';

  @override
  String get errorInvalidId => 'That reference is invalid.';

  @override
  String get errorInternal =>
      'Something went wrong on our end. Please try again.';

  @override
  String get errorAiUnavailable =>
      'The assistant is temporarily unavailable. Please try again shortly.';

  @override
  String get authOtpSendButton => 'Send OTP';

  @override
  String get authOtpTitle => 'Verify your number';

  @override
  String authOtpSentTo(String phone) {
    return 'We sent a 6-digit code to $phone';
  }

  @override
  String get authOtpLabel => 'Verification code';

  @override
  String get authOtpVerifyButton => 'Verify';

  @override
  String get authOtpResend => 'Send it again';

  @override
  String authOtpResendIn(int seconds) {
    return 'You can ask for a new code in ${seconds}s';
  }

  @override
  String get authOtpChangeNumber => 'Use a different number';

  @override
  String get authOtpIncomplete => 'Enter all 6 digits';

  @override
  String get authOtpSimulated =>
      'SMS is not set up on this server, so no message was sent. The code is in the server log.';

  @override
  String get authPhoneVerified => 'Verified';

  @override
  String get authVerifyPhoneButton => 'Verify';

  @override
  String get authAlreadyRegistered =>
      'This phone number is already registered. Please log in instead.';

  @override
  String get authNotRegistered =>
      'No account found for this number. Please create one first.';

  @override
  String get authInviteLabel => 'Have an invite code?';

  @override
  String get authInviteHint => 'Enter invite code';

  @override
  String get authInviteHelper =>
      'Only for dieticians invited by the clinic. Patients can leave this empty.';

  @override
  String get authInviteValidateButton => 'Validate';

  @override
  String get authInviteVerified => 'Dietician invitation verified';

  @override
  String get authInviteInvalid =>
      'That invite code is not valid or has expired.';

  @override
  String get authInviteRemove => 'Remove code';

  @override
  String get authRegisterTitleDietician => 'Dietician registration';

  @override
  String get authRegisterTitlePatient => 'Patient registration';

  @override
  String get authVerifyFirst => 'Verify your phone number to continue';

  @override
  String get authDoctorPasswordLink =>
      'Doctor or clinic staff? Sign in with a password';

  @override
  String get authDoctorPasswordTitle => 'Clinic sign-in';

  @override
  String get authDoctorPasswordSubtitle =>
      'For the doctor and clinic staff. You can also sign in with a code sent by SMS.';

  @override
  String get authUseOtpInstead => 'Sign in with an SMS code instead';

  @override
  String get deskFrontDesk => 'Front desk';

  @override
  String get deskToday => 'Today';

  @override
  String get deskRegister => 'Register';

  @override
  String get deskBooked => 'Booked';

  @override
  String get deskWaiting => 'Waiting';

  @override
  String get deskUnread => 'Unread';

  @override
  String get deskNoAppointments => 'No appointments';

  @override
  String get deskQuietDay =>
      'A quiet day. Walk-ins can be registered from the button below.';

  @override
  String deskWaitingForTimeCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count people are waiting for a time.',
      one: '1 person is waiting for a time.',
    );
    return '$_temp0';
  }

  @override
  String deskAppointmentCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count appointments',
      one: '1 appointment',
    );
    return '$_temp0';
  }

  @override
  String deskNextAt(String name, String time) {
    return 'Next: $name at $time';
  }

  @override
  String get deskAllPassed => 'Everyone booked for today has been and gone.';

  @override
  String get deskNothingBooked => 'Nothing booked today';

  @override
  String get deskNothingBookedBody =>
      'Appointments confirmed for today appear here.';

  @override
  String get deskWaitingForTime => 'Waiting for a time';

  @override
  String deskNeedsAttention(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count need attention now',
      one: 'Needs attention now',
    );
    return '$_temp0';
  }

  @override
  String get deskGiveTime => 'Give a time';

  @override
  String get deskDecline => 'Decline';

  @override
  String get deskDeclineTitle => 'Decline this request?';

  @override
  String get deskDeclineBody =>
      'The patient will be told the clinic could not offer a time. Message them first if there is a reason they should know.';

  @override
  String get deskKeepIt => 'Keep it';

  @override
  String get deskPatientTold => 'The patient has been told.';

  @override
  String get deskPatientFallback => 'Patient';

  @override
  String get deskCheckIn => 'Check in';

  @override
  String get deskCheckedIn => 'Checked in';

  @override
  String get deskWithDoctor => 'With the doctor';

  @override
  String get deskVisitDone => 'Done';

  @override
  String get deskNoShow => 'No show';

  @override
  String get deskConfirmed => 'Confirmed';

  @override
  String deskConfirmedFor(String when) {
    return 'Confirmed for $when';
  }

  @override
  String get deskChange => 'Change';

  @override
  String deskAskedFor(String when) {
    return 'for $when';
  }

  @override
  String deskAskedAgoMinutes(int n) {
    return 'asked ${n}m ago';
  }

  @override
  String deskAskedAgoHours(int n) {
    return 'asked ${n}h ago';
  }

  @override
  String deskAskedAgoDays(int n) {
    return 'asked ${n}d ago';
  }

  @override
  String deskCallPatient(String phone) {
    return 'Call $phone';
  }

  @override
  String get deskNoActiveClinic =>
      'No active clinic to book into. Add one in Profile.';

  @override
  String get deskNoFreeTimes => 'Nothing free on this day';

  @override
  String get deskTryAnotherDay => 'Try another day, or another clinic.';

  @override
  String get deskOnlyAvailable =>
      'Only times the doctor is actually available are offered.';

  @override
  String get deskCouldNotLoadTimes => 'Could not load the times for this day.';

  @override
  String get deskClinicStaff => 'Clinic staff';

  @override
  String get deskTheClinic => 'The clinic';

  @override
  String get deskClinicDetails => 'Clinic details';

  @override
  String get deskClinicDetailsSub =>
      'Name, address, phones, logo and opening hours';

  @override
  String get deskOpeningHours => 'Opening hours';

  @override
  String get deskThisAccount => 'This account';

  @override
  String get deskYourDetails => 'Your details';

  @override
  String get deskYourDetailsSub => 'Name, photo and contact';

  @override
  String get deskSignOut => 'Sign out';

  @override
  String get deskSignOutTitle => 'Sign out?';

  @override
  String get deskSignOutBody =>
      'You will need the clinic number and the password, or a code sent by SMS, to sign in again.';

  @override
  String get deskStay => 'Stay';

  @override
  String get deskPhotoUpdated => 'Photo updated';

  @override
  String get deskTakePhoto => 'Take a photo';

  @override
  String get deskChooseFromGallery => 'Choose from gallery';

  @override
  String get deskAbout => 'About';

  @override
  String get deskNoDeviceLock => 'This phone has no fingerprint or PIN set up.';

  @override
  String get deskAppLockSub =>
      'Ask for the phone’s fingerprint or PIN each time it opens';

  @override
  String get deskCouldNotUpdatePhoto => 'Could not update the photo.';

  @override
  String get deskOpen => 'Open';

  @override
  String get deskClosed => 'Closed';

  @override
  String get deskClosedToday => 'Closed today';

  @override
  String get deskRefresh => 'Refresh';

  @override
  String get deskUrgentChip => 'URGENT';

  @override
  String get deskReviewNow => 'Review now';

  @override
  String get deskTodaysQueue => 'Today\'s queue';

  @override
  String get deskManageQueue => 'Manage queue';

  @override
  String get deskScheduled => 'Scheduled';

  @override
  String get deskInProgress => 'In progress';

  @override
  String get deskForScheduling => 'For scheduling';

  @override
  String get deskNowLabel => 'Now';

  @override
  String get deskTodaysAppointments => 'Today\'s appointments';

  @override
  String get deskViewCalendar => 'View calendar';

  @override
  String get deskNoAppointmentsScheduled => 'No appointments scheduled';

  @override
  String get deskAddWalkIn => 'Add walk-in';

  @override
  String get deskQuickActions => 'Quick actions';

  @override
  String get deskRegisterPatient => 'Register patient';

  @override
  String get deskAddNewPatient => 'Add new patient';

  @override
  String get deskNewAppointment => 'New appointment';

  @override
  String get deskBookAppointment => 'Book appointment';

  @override
  String get deskCheckInPatient => 'Check-in patient';

  @override
  String get deskWalkInCheckIn => 'Walk-in check-in';

  @override
  String get deskMessagesLabel => 'Messages';

  @override
  String get deskClinicSummary => 'Clinic summary';

  @override
  String get deskCompleted => 'Completed';

  @override
  String get deskCancelled => 'Cancelled';

  @override
  String get deskNoShows => 'No shows';

  @override
  String get deskTotalVisitors => 'Total visitors';

  @override
  String get deskOfferTime => 'Offer a time';

  @override
  String get deskWaitingForScheduling => 'Waiting for scheduling';

  @override
  String get deskCatUrgent => 'Urgent';

  @override
  String get deskCatAppointments => 'Appointments';

  @override
  String get deskCatMessages => 'Messages';

  @override
  String get deskUrgentSymptom => 'Urgent patient-reported symptom';

  @override
  String get deskNothingInProgress => 'No appointment in progress';

  @override
  String deskClosesAt(String time) {
    return 'Closes $time';
  }

  @override
  String deskOpensAt(String time) {
    return 'Opens $time';
  }

  @override
  String deskUnreadCount(int count) {
    return '$count unread';
  }

  @override
  String deskReportedAgoMinutes(int count) {
    return 'Reported $count min ago';
  }

  @override
  String deskReportedAgoHours(int count) {
    return 'Reported $count h ago';
  }

  @override
  String deskReportedAgoDays(int count) {
    return 'Reported $count d ago';
  }

  @override
  String deskWaitingCount(int count) {
    return '$count waiting for scheduling';
  }

  @override
  String get rangeThisWeek => 'This week';

  @override
  String get deskChoosePatient => 'Choose a patient';

  @override
  String get deskSearchPatients => 'Search by name or phone';

  @override
  String get deskNoPatientsFound => 'No patients found';

  @override
  String get deskNobodyToCheckIn => 'Nobody is waiting to be checked in.';
}
