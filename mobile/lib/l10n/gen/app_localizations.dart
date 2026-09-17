import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_bn.dart';
import 'app_localizations_en.dart';
import 'app_localizations_hi.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'gen/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('bn'),
    Locale('en'),
    Locale('hi'),
  ];

  /// App name shown on splash and title bars
  ///
  /// In en, this message translates to:
  /// **'MedPin'**
  String get appName;

  /// No description provided for @appTagline.
  ///
  /// In en, this message translates to:
  /// **'Diabetes care with Dr. Amit Kumar Dey'**
  String get appTagline;

  /// No description provided for @commonRetry.
  ///
  /// In en, this message translates to:
  /// **'Retry'**
  String get commonRetry;

  /// No description provided for @commonCancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get commonCancel;

  /// No description provided for @commonSave.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get commonSave;

  /// No description provided for @commonSubmit.
  ///
  /// In en, this message translates to:
  /// **'Submit'**
  String get commonSubmit;

  /// No description provided for @commonLoading.
  ///
  /// In en, this message translates to:
  /// **'Loading…'**
  String get commonLoading;

  /// No description provided for @commonOk.
  ///
  /// In en, this message translates to:
  /// **'OK'**
  String get commonOk;

  /// No description provided for @commonClose.
  ///
  /// In en, this message translates to:
  /// **'Close'**
  String get commonClose;

  /// No description provided for @commonDelete.
  ///
  /// In en, this message translates to:
  /// **'Delete'**
  String get commonDelete;

  /// No description provided for @commonEdit.
  ///
  /// In en, this message translates to:
  /// **'Edit'**
  String get commonEdit;

  /// No description provided for @commonYes.
  ///
  /// In en, this message translates to:
  /// **'Yes'**
  String get commonYes;

  /// No description provided for @commonNo.
  ///
  /// In en, this message translates to:
  /// **'No'**
  String get commonNo;

  /// No description provided for @commonSomethingWentWrong.
  ///
  /// In en, this message translates to:
  /// **'Something went wrong'**
  String get commonSomethingWentWrong;

  /// No description provided for @commonNoInternet.
  ///
  /// In en, this message translates to:
  /// **'No internet connection. Please check your network.'**
  String get commonNoInternet;

  /// No description provided for @commonTryAgain.
  ///
  /// In en, this message translates to:
  /// **'Try again'**
  String get commonTryAgain;

  /// No description provided for @commonComingSoon.
  ///
  /// In en, this message translates to:
  /// **'Coming next'**
  String get commonComingSoon;

  /// No description provided for @commonComingSoonBody.
  ///
  /// In en, this message translates to:
  /// **'This section is being built and will be available in a future update.'**
  String get commonComingSoonBody;

  /// No description provided for @commonRequiredField.
  ///
  /// In en, this message translates to:
  /// **'This field is required'**
  String get commonRequiredField;

  /// No description provided for @commonUnknownError.
  ///
  /// In en, this message translates to:
  /// **'An unexpected error occurred'**
  String get commonUnknownError;

  /// No description provided for @languagePickerTitle.
  ///
  /// In en, this message translates to:
  /// **'Choose your language'**
  String get languagePickerTitle;

  /// No description provided for @languagePickerSubtitle.
  ///
  /// In en, this message translates to:
  /// **'You can change this anytime from your profile.'**
  String get languagePickerSubtitle;

  /// No description provided for @languageEnglish.
  ///
  /// In en, this message translates to:
  /// **'English'**
  String get languageEnglish;

  /// No description provided for @languageBengali.
  ///
  /// In en, this message translates to:
  /// **'বাংলা'**
  String get languageBengali;

  /// No description provided for @languageHindi.
  ///
  /// In en, this message translates to:
  /// **'हिन्दी'**
  String get languageHindi;

  /// No description provided for @continueButton.
  ///
  /// In en, this message translates to:
  /// **'Continue'**
  String get continueButton;

  /// No description provided for @authLoginTitle.
  ///
  /// In en, this message translates to:
  /// **'Welcome back'**
  String get authLoginTitle;

  /// No description provided for @authLoginSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Log in to manage your diabetes care.'**
  String get authLoginSubtitle;

  /// No description provided for @authRegisterTitle.
  ///
  /// In en, this message translates to:
  /// **'Create your account'**
  String get authRegisterTitle;

  /// No description provided for @authRegisterSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Tell us a little about yourself to get started.'**
  String get authRegisterSubtitle;

  /// No description provided for @authPhoneLabel.
  ///
  /// In en, this message translates to:
  /// **'Phone number'**
  String get authPhoneLabel;

  /// No description provided for @authPhoneHint.
  ///
  /// In en, this message translates to:
  /// **'Enter your 10-digit number'**
  String get authPhoneHint;

  /// No description provided for @authPasswordHint.
  ///
  /// In en, this message translates to:
  /// **'Enter your password'**
  String get authPasswordHint;

  /// No description provided for @authPasswordLabel.
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get authPasswordLabel;

  /// No description provided for @authNameLabel.
  ///
  /// In en, this message translates to:
  /// **'Full name'**
  String get authNameLabel;

  /// No description provided for @authEmailLabel.
  ///
  /// In en, this message translates to:
  /// **'Email (optional)'**
  String get authEmailLabel;

  /// No description provided for @authDateOfBirthLabel.
  ///
  /// In en, this message translates to:
  /// **'Date of birth'**
  String get authDateOfBirthLabel;

  /// No description provided for @authGenderLabel.
  ///
  /// In en, this message translates to:
  /// **'Gender'**
  String get authGenderLabel;

  /// No description provided for @authGenderMale.
  ///
  /// In en, this message translates to:
  /// **'Male'**
  String get authGenderMale;

  /// No description provided for @authGenderFemale.
  ///
  /// In en, this message translates to:
  /// **'Female'**
  String get authGenderFemale;

  /// No description provided for @authGenderOther.
  ///
  /// In en, this message translates to:
  /// **'Other'**
  String get authGenderOther;

  /// No description provided for @authDiabetesTypeLabel.
  ///
  /// In en, this message translates to:
  /// **'Diabetes type'**
  String get authDiabetesTypeLabel;

  /// No description provided for @authDiabetesType1.
  ///
  /// In en, this message translates to:
  /// **'Type 1'**
  String get authDiabetesType1;

  /// No description provided for @authDiabetesType2.
  ///
  /// In en, this message translates to:
  /// **'Type 2'**
  String get authDiabetesType2;

  /// No description provided for @authDiabetesTypeGestational.
  ///
  /// In en, this message translates to:
  /// **'Gestational'**
  String get authDiabetesTypeGestational;

  /// No description provided for @authDiabetesTypePrediabetes.
  ///
  /// In en, this message translates to:
  /// **'Prediabetes'**
  String get authDiabetesTypePrediabetes;

  /// No description provided for @authLoginButton.
  ///
  /// In en, this message translates to:
  /// **'Log in'**
  String get authLoginButton;

  /// No description provided for @authRegisterButton.
  ///
  /// In en, this message translates to:
  /// **'Create account'**
  String get authRegisterButton;

  /// No description provided for @authNoAccount.
  ///
  /// In en, this message translates to:
  /// **'Don\'t have an account?'**
  String get authNoAccount;

  /// No description provided for @authHaveAccount.
  ///
  /// In en, this message translates to:
  /// **'Already have an account?'**
  String get authHaveAccount;

  /// No description provided for @authGoToRegister.
  ///
  /// In en, this message translates to:
  /// **'Register'**
  String get authGoToRegister;

  /// No description provided for @authGoToLogin.
  ///
  /// In en, this message translates to:
  /// **'Log in'**
  String get authGoToLogin;

  /// No description provided for @authInvalidCredentials.
  ///
  /// In en, this message translates to:
  /// **'Incorrect phone number or password'**
  String get authInvalidCredentials;

  /// No description provided for @authPasswordTooShort.
  ///
  /// In en, this message translates to:
  /// **'Password must be at least 8 characters'**
  String get authPasswordTooShort;

  /// Helper text under the password field on the register screen
  ///
  /// In en, this message translates to:
  /// **'At least 8 characters'**
  String get authPasswordHelper;

  /// Shown when the entered name is shorter than the server minimum of 2 characters
  ///
  /// In en, this message translates to:
  /// **'Please enter your full name'**
  String get authNameTooShort;

  /// No description provided for @authInvalidPhone.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid 10-digit mobile number'**
  String get authInvalidPhone;

  /// No description provided for @authInvalidEmail.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid email address, or leave it blank'**
  String get authInvalidEmail;

  /// No description provided for @authPasswordRequired.
  ///
  /// In en, this message translates to:
  /// **'Please enter your password'**
  String get authPasswordRequired;

  /// No description provided for @authPasswordTooLong.
  ///
  /// In en, this message translates to:
  /// **'Password must be 128 characters or fewer'**
  String get authPasswordTooLong;

  /// No description provided for @authConfirmPasswordLabel.
  ///
  /// In en, this message translates to:
  /// **'Confirm password'**
  String get authConfirmPasswordLabel;

  /// There is no password-reset flow, so a typo at registration locks the account permanently
  ///
  /// In en, this message translates to:
  /// **'Passwords do not match'**
  String get authPasswordMismatch;

  /// No description provided for @authNameTooLong.
  ///
  /// In en, this message translates to:
  /// **'Name must be 120 characters or fewer'**
  String get authNameTooLong;

  /// No description provided for @authDateOfBirthRequired.
  ///
  /// In en, this message translates to:
  /// **'Please select your date of birth'**
  String get authDateOfBirthRequired;

  /// No description provided for @authDateOfBirthTooYoung.
  ///
  /// In en, this message translates to:
  /// **'Date of birth must be at least 1 year ago'**
  String get authDateOfBirthTooYoung;

  /// No description provided for @authGenderRequired.
  ///
  /// In en, this message translates to:
  /// **'Please select an option'**
  String get authGenderRequired;

  /// Must be an explicit choice — the server otherwise silently records the patient as Type 2
  ///
  /// In en, this message translates to:
  /// **'Please select your diabetes type'**
  String get authDiabetesTypeRequired;

  /// No description provided for @authDiabetesTypeNone.
  ///
  /// In en, this message translates to:
  /// **'None / not diabetic'**
  String get authDiabetesTypeNone;

  /// No description provided for @authDiabetesTypeHelper.
  ///
  /// In en, this message translates to:
  /// **'Ask your doctor if you are not sure'**
  String get authDiabetesTypeHelper;

  /// No description provided for @authLogoutConfirmTitle.
  ///
  /// In en, this message translates to:
  /// **'Log out?'**
  String get authLogoutConfirmTitle;

  /// No description provided for @authLogoutConfirmBody.
  ///
  /// In en, this message translates to:
  /// **'You will need to log in again to access your care details.'**
  String get authLogoutConfirmBody;

  /// No description provided for @navHome.
  ///
  /// In en, this message translates to:
  /// **'Home'**
  String get navHome;

  /// No description provided for @navChat.
  ///
  /// In en, this message translates to:
  /// **'Chat'**
  String get navChat;

  /// No description provided for @navTrack.
  ///
  /// In en, this message translates to:
  /// **'Track'**
  String get navTrack;

  /// No description provided for @navCare.
  ///
  /// In en, this message translates to:
  /// **'Care'**
  String get navCare;

  /// No description provided for @navProfile.
  ///
  /// In en, this message translates to:
  /// **'Profile'**
  String get navProfile;

  /// No description provided for @dashboardGreetingMorning.
  ///
  /// In en, this message translates to:
  /// **'Good morning, {name}'**
  String dashboardGreetingMorning(String name);

  /// No description provided for @dashboardGreetingAfternoon.
  ///
  /// In en, this message translates to:
  /// **'Good afternoon, {name}'**
  String dashboardGreetingAfternoon(String name);

  /// No description provided for @dashboardGreetingEvening.
  ///
  /// In en, this message translates to:
  /// **'Good evening, {name}'**
  String dashboardGreetingEvening(String name);

  /// No description provided for @dashboardHealthScore.
  ///
  /// In en, this message translates to:
  /// **'Health score'**
  String get dashboardHealthScore;

  /// No description provided for @dashboardHealthScoreBand.
  ///
  /// In en, this message translates to:
  /// **'{band}'**
  String dashboardHealthScoreBand(String band);

  /// No description provided for @dashboardGlucoseLatest.
  ///
  /// In en, this message translates to:
  /// **'Latest glucose'**
  String get dashboardGlucoseLatest;

  /// No description provided for @dashboardGlucoseAverage.
  ///
  /// In en, this message translates to:
  /// **'7-day average'**
  String get dashboardGlucoseAverage;

  /// No description provided for @dashboardTimeInRange.
  ///
  /// In en, this message translates to:
  /// **'Time in range'**
  String get dashboardTimeInRange;

  /// No description provided for @dashboardAdherence.
  ///
  /// In en, this message translates to:
  /// **'Medicine adherence'**
  String get dashboardAdherence;

  /// No description provided for @dashboardTodayPending.
  ///
  /// In en, this message translates to:
  /// **'{count} due today'**
  String dashboardTodayPending(int count);

  /// No description provided for @dashboardNextAppointment.
  ///
  /// In en, this message translates to:
  /// **'Next appointment'**
  String get dashboardNextAppointment;

  /// Dashboard: dashboardAppointmentRequested
  ///
  /// In en, this message translates to:
  /// **'Appointment requested'**
  String get dashboardAppointmentRequested;

  /// Dashboard: dashboardWaitingForClinic
  ///
  /// In en, this message translates to:
  /// **'Waiting for the clinic to confirm a time'**
  String get dashboardWaitingForClinic;

  /// Dashboard: dashboardAwaitingTime
  ///
  /// In en, this message translates to:
  /// **'The clinic will confirm a day and time'**
  String get dashboardAwaitingTime;

  /// No description provided for @dashboardNoAppointment.
  ///
  /// In en, this message translates to:
  /// **'No upcoming appointment'**
  String get dashboardNoAppointment;

  /// No description provided for @dashboardOpenAlerts.
  ///
  /// In en, this message translates to:
  /// **'Open alerts'**
  String get dashboardOpenAlerts;

  /// No description provided for @dashboardNoAlerts.
  ///
  /// In en, this message translates to:
  /// **'No open alerts'**
  String get dashboardNoAlerts;

  /// No description provided for @dashboardRecommendations.
  ///
  /// In en, this message translates to:
  /// **'Recommendations for you'**
  String get dashboardRecommendations;

  /// No description provided for @dashboardNoRecommendations.
  ///
  /// In en, this message translates to:
  /// **'You\'re all caught up'**
  String get dashboardNoRecommendations;

  /// No description provided for @dashboardFootScreeningDue.
  ///
  /// In en, this message translates to:
  /// **'Foot screening due'**
  String get dashboardFootScreeningDue;

  /// No description provided for @dashboardEyeScreeningDue.
  ///
  /// In en, this message translates to:
  /// **'Eye screening due'**
  String get dashboardEyeScreeningDue;

  /// No description provided for @dashboardHba1cDue.
  ///
  /// In en, this message translates to:
  /// **'HbA1c test due'**
  String get dashboardHba1cDue;

  /// No description provided for @dashboardEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'No dashboard data yet'**
  String get dashboardEmptyTitle;

  /// No description provided for @dashboardEmptyBody.
  ///
  /// In en, this message translates to:
  /// **'Start logging your glucose and medicines to see your health summary here.'**
  String get dashboardEmptyBody;

  /// No description provided for @dashboardErrorTitle.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load your dashboard'**
  String get dashboardErrorTitle;

  /// No description provided for @chatTitle.
  ///
  /// In en, this message translates to:
  /// **'Dr. Dey\'s Clinic'**
  String get chatTitle;

  /// No description provided for @chatFromClinic.
  ///
  /// In en, this message translates to:
  /// **'From the clinic'**
  String get chatFromClinic;

  /// No description provided for @appLockSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Unlock to see your messages and health records.'**
  String get appLockSubtitle;

  /// No description provided for @profileFeedback.
  ///
  /// In en, this message translates to:
  /// **'Send feedback'**
  String get profileFeedback;

  /// No description provided for @profileFeedbackSub.
  ///
  /// In en, this message translates to:
  /// **'About the clinic or this app'**
  String get profileFeedbackSub;

  /// No description provided for @chatTapToStop.
  ///
  /// In en, this message translates to:
  /// **'TAP TO STOP'**
  String get chatTapToStop;

  /// No description provided for @chatRecordVoice.
  ///
  /// In en, this message translates to:
  /// **'Record a voice message'**
  String get chatRecordVoice;

  /// No description provided for @chatVoiceSending.
  ///
  /// In en, this message translates to:
  /// **'Sending your voice message…'**
  String get chatVoiceSending;

  /// No description provided for @chatVoiceFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not send your voice message. Please try again.'**
  String get chatVoiceFailed;

  /// No description provided for @chatVoiceUnclear.
  ///
  /// In en, this message translates to:
  /// **'I could not make out the recording. Please try again, or type your message.'**
  String get chatVoiceUnclear;

  /// No description provided for @chatReply.
  ///
  /// In en, this message translates to:
  /// **'Reply'**
  String get chatReply;

  /// No description provided for @chatPin.
  ///
  /// In en, this message translates to:
  /// **'Pin to top'**
  String get chatPin;

  /// No description provided for @chatUnpin.
  ///
  /// In en, this message translates to:
  /// **'Unpin'**
  String get chatUnpin;

  /// No description provided for @chatHide.
  ///
  /// In en, this message translates to:
  /// **'Hide for me'**
  String get chatHide;

  /// No description provided for @chatHideNote.
  ///
  /// In en, this message translates to:
  /// **'Stays in your medical record; only removed from your view'**
  String get chatHideNote;

  /// No description provided for @chatDeleteForEveryone.
  ///
  /// In en, this message translates to:
  /// **'Delete for everyone'**
  String get chatDeleteForEveryone;

  /// No description provided for @chatDeletedForEveryone.
  ///
  /// In en, this message translates to:
  /// **'This message was deleted'**
  String get chatDeletedForEveryone;

  /// No description provided for @chatDeleteForEveryoneConfirm.
  ///
  /// In en, this message translates to:
  /// **'This message will be removed for everyone in the chat. This can\'t be undone.'**
  String get chatDeleteForEveryoneConfirm;

  /// No description provided for @chatPinned.
  ///
  /// In en, this message translates to:
  /// **'Pinned'**
  String get chatPinned;

  /// No description provided for @chatSeenByClinic.
  ///
  /// In en, this message translates to:
  /// **'Seen by the clinic'**
  String get chatSeenByClinic;

  /// No description provided for @chatReplyingTo.
  ///
  /// In en, this message translates to:
  /// **'Replying to'**
  String get chatReplyingTo;

  /// No description provided for @chatCannotHideEmergency.
  ///
  /// In en, this message translates to:
  /// **'This is part of an emergency record and cannot be hidden'**
  String get chatCannotHideEmergency;

  /// No description provided for @chatReplyToPatient.
  ///
  /// In en, this message translates to:
  /// **'Reply to this patient…'**
  String get chatReplyToPatient;

  /// No description provided for @chatReplySent.
  ///
  /// In en, this message translates to:
  /// **'Sent to the patient'**
  String get chatReplySent;

  /// No description provided for @chatComposerHint.
  ///
  /// In en, this message translates to:
  /// **'Ask about your health…'**
  String get chatComposerHint;

  /// No description provided for @chatSend.
  ///
  /// In en, this message translates to:
  /// **'Send'**
  String get chatSend;

  /// No description provided for @chatSessions.
  ///
  /// In en, this message translates to:
  /// **'Chat history'**
  String get chatSessions;

  /// No description provided for @chatSessionsEmpty.
  ///
  /// In en, this message translates to:
  /// **'No previous chats yet'**
  String get chatSessionsEmpty;

  /// No description provided for @chatDisclaimer.
  ///
  /// In en, this message translates to:
  /// **'AI-assisted guidance, not a diagnosis'**
  String get chatDisclaimer;

  /// No description provided for @chatThinking.
  ///
  /// In en, this message translates to:
  /// **'MedPin Assistant is typing…'**
  String get chatThinking;

  /// No description provided for @chatEmergencyTitle.
  ///
  /// In en, this message translates to:
  /// **'Emergency — act now'**
  String get chatEmergencyTitle;

  /// No description provided for @chatEmergencyBody.
  ///
  /// In en, this message translates to:
  /// **'Go to the nearest hospital immediately'**
  String get chatEmergencyBody;

  /// No description provided for @chatCallClinic.
  ///
  /// In en, this message translates to:
  /// **'Call clinic'**
  String get chatCallClinic;

  /// No description provided for @chatUrgentTitle.
  ///
  /// In en, this message translates to:
  /// **'Needs prompt attention'**
  String get chatUrgentTitle;

  /// No description provided for @chatCitations.
  ///
  /// In en, this message translates to:
  /// **'Sources'**
  String get chatCitations;

  /// No description provided for @chatFlagMessage.
  ///
  /// In en, this message translates to:
  /// **'Report this answer'**
  String get chatFlagMessage;

  /// No description provided for @chatFlagSent.
  ///
  /// In en, this message translates to:
  /// **'Thank you, this reply has been reported for review.'**
  String get chatFlagSent;

  /// No description provided for @chatWelcomeTitle.
  ///
  /// In en, this message translates to:
  /// **'Hello, I\'m your MedPin Assistant'**
  String get chatWelcomeTitle;

  /// No description provided for @chatWelcomeBody.
  ///
  /// In en, this message translates to:
  /// **'Ask me about your glucose readings, medicines, diet, or any diabetes-related question. In an emergency, always call the clinic or go to the nearest hospital.'**
  String get chatWelcomeBody;

  /// No description provided for @chatEmptyInput.
  ///
  /// In en, this message translates to:
  /// **'Type a message before sending'**
  String get chatEmptyInput;

  /// No description provided for @chatArchiveSession.
  ///
  /// In en, this message translates to:
  /// **'Archive'**
  String get chatArchiveSession;

  /// No description provided for @chatArchived.
  ///
  /// In en, this message translates to:
  /// **'Chat archived'**
  String get chatArchived;

  /// No description provided for @chatAnalyzing.
  ///
  /// In en, this message translates to:
  /// **'MedPin is analyzing data…'**
  String get chatAnalyzing;

  /// No description provided for @chatAttach.
  ///
  /// In en, this message translates to:
  /// **'Attach a photo'**
  String get chatAttach;

  /// No description provided for @chatAttachCamera.
  ///
  /// In en, this message translates to:
  /// **'Take a photo'**
  String get chatAttachCamera;

  /// No description provided for @chatAttachGallery.
  ///
  /// In en, this message translates to:
  /// **'Choose from gallery'**
  String get chatAttachGallery;

  /// No description provided for @chatAttachRemove.
  ///
  /// In en, this message translates to:
  /// **'Remove attachment'**
  String get chatAttachRemove;

  /// No description provided for @chatAttachUploading.
  ///
  /// In en, this message translates to:
  /// **'Uploading…'**
  String get chatAttachUploading;

  /// No description provided for @chatAttachFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not upload that photo. Please try again.'**
  String get chatAttachFailed;

  /// No description provided for @chatAttachTooLarge.
  ///
  /// In en, this message translates to:
  /// **'That photo is too large. Please choose one under 12 MB.'**
  String get chatAttachTooLarge;

  /// No description provided for @chatAttachLimit.
  ///
  /// In en, this message translates to:
  /// **'You can attach up to 5 photos.'**
  String get chatAttachLimit;

  /// The server requires non-empty text on every chat message, so a photo cannot be sent on its own
  ///
  /// In en, this message translates to:
  /// **'Add a short note describing the photo before sending.'**
  String get chatAttachNeedsText;

  /// No description provided for @chatEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'How can I help today?'**
  String get chatEmptyTitle;

  /// No description provided for @chatEmptyBody.
  ///
  /// In en, this message translates to:
  /// **'Ask about your blood sugar, diet, medicines or symptoms. Available 24/7.'**
  String get chatEmptyBody;

  /// No description provided for @chatSuggestionSugar.
  ///
  /// In en, this message translates to:
  /// **'My blood sugar is high today — what should I do?'**
  String get chatSuggestionSugar;

  /// No description provided for @chatSuggestionDiet.
  ///
  /// In en, this message translates to:
  /// **'What are some healthy breakfast ideas?'**
  String get chatSuggestionDiet;

  /// No description provided for @chatSuggestionFeet.
  ///
  /// In en, this message translates to:
  /// **'My feet feel numb and tingly. Should I worry?'**
  String get chatSuggestionFeet;

  /// No description provided for @chatSuggestionEye.
  ///
  /// In en, this message translates to:
  /// **'Help me understand my eye report'**
  String get chatSuggestionEye;

  /// No description provided for @chatCopy.
  ///
  /// In en, this message translates to:
  /// **'Copy'**
  String get chatCopy;

  /// No description provided for @chatCopied.
  ///
  /// In en, this message translates to:
  /// **'Copied to clipboard'**
  String get chatCopied;

  /// No description provided for @chatRetry.
  ///
  /// In en, this message translates to:
  /// **'Try again'**
  String get chatRetry;

  /// No description provided for @chatScrollToLatest.
  ///
  /// In en, this message translates to:
  /// **'Jump to latest'**
  String get chatScrollToLatest;

  /// No description provided for @chatDateToday.
  ///
  /// In en, this message translates to:
  /// **'Today'**
  String get chatDateToday;

  /// No description provided for @chatDateYesterday.
  ///
  /// In en, this message translates to:
  /// **'Yesterday'**
  String get chatDateYesterday;

  /// No description provided for @voiceListening.
  ///
  /// In en, this message translates to:
  /// **'Listening…'**
  String get voiceListening;

  /// No description provided for @voiceTapToSpeak.
  ///
  /// In en, this message translates to:
  /// **'Speak to the assistant'**
  String get voiceTapToSpeak;

  /// No description provided for @voiceDone.
  ///
  /// In en, this message translates to:
  /// **'Done'**
  String get voiceDone;

  /// No description provided for @voiceCancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get voiceCancel;

  /// No description provided for @voiceNoSpeech.
  ///
  /// In en, this message translates to:
  /// **'I didn\'t catch that — try again'**
  String get voiceNoSpeech;

  /// No description provided for @voicePermissionTitle.
  ///
  /// In en, this message translates to:
  /// **'Microphone access is needed'**
  String get voicePermissionTitle;

  /// No description provided for @voicePermissionBody.
  ///
  /// In en, this message translates to:
  /// **'Allow microphone access so you can speak instead of typing.'**
  String get voicePermissionBody;

  /// No description provided for @voiceOpenSettings.
  ///
  /// In en, this message translates to:
  /// **'Open settings'**
  String get voiceOpenSettings;

  /// No description provided for @voiceUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Voice input isn\'t available on this device'**
  String get voiceUnavailable;

  /// No description provided for @voiceSlideToCancel.
  ///
  /// In en, this message translates to:
  /// **'Slide to cancel'**
  String get voiceSlideToCancel;

  /// No description provided for @voiceSlideToLock.
  ///
  /// In en, this message translates to:
  /// **'Slide up to lock, hands-free'**
  String get voiceSlideToLock;

  /// No description provided for @voiceReleaseToCancel.
  ///
  /// In en, this message translates to:
  /// **'Release to cancel'**
  String get voiceReleaseToCancel;

  /// No description provided for @voiceRecording.
  ///
  /// In en, this message translates to:
  /// **'Recording'**
  String get voiceRecording;

  /// Speech recognition mishears numbers, and a number here is a blood sugar reading — the patient must confirm the text rather than it being sent automatically
  ///
  /// In en, this message translates to:
  /// **'Check the text before sending'**
  String get voiceReviewBeforeSending;

  /// No description provided for @glucoseTitle.
  ///
  /// In en, this message translates to:
  /// **'Glucose'**
  String get glucoseTitle;

  /// No description provided for @glucoseLogReading.
  ///
  /// In en, this message translates to:
  /// **'Log a reading'**
  String get glucoseLogReading;

  /// No description provided for @glucoseValueLabel.
  ///
  /// In en, this message translates to:
  /// **'Blood glucose (mg/dL)'**
  String get glucoseValueLabel;

  /// No description provided for @glucoseContextLabel.
  ///
  /// In en, this message translates to:
  /// **'When was this taken?'**
  String get glucoseContextLabel;

  /// No description provided for @glucoseContextFasting.
  ///
  /// In en, this message translates to:
  /// **'Fasting'**
  String get glucoseContextFasting;

  /// No description provided for @glucoseContextPreMeal.
  ///
  /// In en, this message translates to:
  /// **'Before meal'**
  String get glucoseContextPreMeal;

  /// No description provided for @glucoseContextPostMeal.
  ///
  /// In en, this message translates to:
  /// **'After meal'**
  String get glucoseContextPostMeal;

  /// No description provided for @glucoseContextBedtime.
  ///
  /// In en, this message translates to:
  /// **'Bedtime'**
  String get glucoseContextBedtime;

  /// No description provided for @glucoseContextRandom.
  ///
  /// In en, this message translates to:
  /// **'Random'**
  String get glucoseContextRandom;

  /// No description provided for @glucoseTimeLabel.
  ///
  /// In en, this message translates to:
  /// **'Date & time'**
  String get glucoseTimeLabel;

  /// No description provided for @glucoseNotesLabel.
  ///
  /// In en, this message translates to:
  /// **'Notes (optional)'**
  String get glucoseNotesLabel;

  /// No description provided for @glucoseSaveReading.
  ///
  /// In en, this message translates to:
  /// **'Save reading'**
  String get glucoseSaveReading;

  /// No description provided for @glucoseReadingSaved.
  ///
  /// In en, this message translates to:
  /// **'Reading saved'**
  String get glucoseReadingSaved;

  /// No description provided for @glucoseTrend.
  ///
  /// In en, this message translates to:
  /// **'30-day trend'**
  String get glucoseTrend;

  /// No description provided for @glucoseTargetRange.
  ///
  /// In en, this message translates to:
  /// **'Target range'**
  String get glucoseTargetRange;

  /// No description provided for @glucoseRecentReadings.
  ///
  /// In en, this message translates to:
  /// **'Recent readings'**
  String get glucoseRecentReadings;

  /// No description provided for @glucoseEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'No readings yet'**
  String get glucoseEmptyTitle;

  /// No description provided for @glucoseEmptyBody.
  ///
  /// In en, this message translates to:
  /// **'Log your first blood glucose reading to start tracking your trend.'**
  String get glucoseEmptyBody;

  /// No description provided for @glucoseFlagSevereLow.
  ///
  /// In en, this message translates to:
  /// **'Severe low'**
  String get glucoseFlagSevereLow;

  /// No description provided for @glucoseFlagLow.
  ///
  /// In en, this message translates to:
  /// **'Low'**
  String get glucoseFlagLow;

  /// No description provided for @glucoseFlagInRange.
  ///
  /// In en, this message translates to:
  /// **'In range'**
  String get glucoseFlagInRange;

  /// No description provided for @glucoseFlagVeryHigh.
  ///
  /// In en, this message translates to:
  /// **'Very high'**
  String get glucoseFlagVeryHigh;

  /// No description provided for @glucoseFlagCriticalHigh.
  ///
  /// In en, this message translates to:
  /// **'Critical high'**
  String get glucoseFlagCriticalHigh;

  /// No description provided for @glucoseDeleteConfirm.
  ///
  /// In en, this message translates to:
  /// **'Delete this reading?'**
  String get glucoseDeleteConfirm;

  /// No description provided for @glucoseStatsAverage.
  ///
  /// In en, this message translates to:
  /// **'Average'**
  String get glucoseStatsAverage;

  /// No description provided for @glucoseStatsMin.
  ///
  /// In en, this message translates to:
  /// **'Lowest'**
  String get glucoseStatsMin;

  /// No description provided for @glucoseStatsMax.
  ///
  /// In en, this message translates to:
  /// **'Highest'**
  String get glucoseStatsMax;

  /// No description provided for @glucoseStatsHba1c.
  ///
  /// In en, this message translates to:
  /// **'Estimated HbA1c'**
  String get glucoseStatsHba1c;

  /// No description provided for @medsTitle.
  ///
  /// In en, this message translates to:
  /// **'Medications'**
  String get medsTitle;

  /// No description provided for @medsTodaySchedule.
  ///
  /// In en, this message translates to:
  /// **'Today\'s schedule'**
  String get medsTodaySchedule;

  /// No description provided for @medsAdherence.
  ///
  /// In en, this message translates to:
  /// **'Adherence'**
  String get medsAdherence;

  /// No description provided for @medsMarkTaken.
  ///
  /// In en, this message translates to:
  /// **'Mark taken'**
  String get medsMarkTaken;

  /// No description provided for @medsMarkSkipped.
  ///
  /// In en, this message translates to:
  /// **'Mark skipped'**
  String get medsMarkSkipped;

  /// No description provided for @medsStatusTaken.
  ///
  /// In en, this message translates to:
  /// **'Taken'**
  String get medsStatusTaken;

  /// No description provided for @medsStatusSkipped.
  ///
  /// In en, this message translates to:
  /// **'Skipped'**
  String get medsStatusSkipped;

  /// No description provided for @medsStatusPending.
  ///
  /// In en, this message translates to:
  /// **'Pending'**
  String get medsStatusPending;

  /// No description provided for @medsStatusMissed.
  ///
  /// In en, this message translates to:
  /// **'Missed'**
  String get medsStatusMissed;

  /// No description provided for @medsEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'No medicines scheduled today'**
  String get medsEmptyTitle;

  /// No description provided for @medsEmptyBody.
  ///
  /// In en, this message translates to:
  /// **'Your doctor hasn\'t added any medicines for today.'**
  String get medsEmptyBody;

  /// No description provided for @medsRelationBeforeMeal.
  ///
  /// In en, this message translates to:
  /// **'Before meal'**
  String get medsRelationBeforeMeal;

  /// No description provided for @medsRelationAfterMeal.
  ///
  /// In en, this message translates to:
  /// **'After meal'**
  String get medsRelationAfterMeal;

  /// No description provided for @medsRelationWithMeal.
  ///
  /// In en, this message translates to:
  /// **'With meal'**
  String get medsRelationWithMeal;

  /// No description provided for @medsRelationAnytime.
  ///
  /// In en, this message translates to:
  /// **'Anytime'**
  String get medsRelationAnytime;

  /// No description provided for @medsSkipReasonTitle.
  ///
  /// In en, this message translates to:
  /// **'Why are you skipping this dose?'**
  String get medsSkipReasonTitle;

  /// No description provided for @ptTabDoctor.
  ///
  /// In en, this message translates to:
  /// **'Doctor'**
  String get ptTabDoctor;

  /// No description provided for @ptTabAssistant.
  ///
  /// In en, this message translates to:
  /// **'Assistant'**
  String get ptTabAssistant;

  /// No description provided for @ptTabMedicines.
  ///
  /// In en, this message translates to:
  /// **'Medicines'**
  String get ptTabMedicines;

  /// No description provided for @ptTabDietician.
  ///
  /// In en, this message translates to:
  /// **'Dietician'**
  String get ptTabDietician;

  /// No description provided for @ptNothingLost.
  ///
  /// In en, this message translates to:
  /// **'Your records are safe. Check your connection and try again.'**
  String get ptNothingLost;

  /// No description provided for @ptStaleShowingLastLoaded.
  ///
  /// In en, this message translates to:
  /// **'Could not refresh. Showing what was loaded at {time}.'**
  String ptStaleShowingLastLoaded(String time);

  /// No description provided for @ptStaleShowingEarlier.
  ///
  /// In en, this message translates to:
  /// **'Could not refresh. Showing what was loaded earlier.'**
  String get ptStaleShowingEarlier;

  /// No description provided for @ptGreetingMorning.
  ///
  /// In en, this message translates to:
  /// **'Good morning'**
  String get ptGreetingMorning;

  /// No description provided for @ptGreetingAfternoon.
  ///
  /// In en, this message translates to:
  /// **'Good afternoon'**
  String get ptGreetingAfternoon;

  /// No description provided for @ptGreetingEvening.
  ///
  /// In en, this message translates to:
  /// **'Good evening'**
  String get ptGreetingEvening;

  /// No description provided for @ptCouldNotLoadCarePlan.
  ///
  /// In en, this message translates to:
  /// **'Could not load your care summary.'**
  String get ptCouldNotLoadCarePlan;

  /// No description provided for @ptTodayTitle.
  ///
  /// In en, this message translates to:
  /// **'Today'**
  String get ptTodayTitle;

  /// No description provided for @ptCouldNotLoadTodaysMedicines.
  ///
  /// In en, this message translates to:
  /// **'Could not load today\'s medicines.'**
  String get ptCouldNotLoadTodaysMedicines;

  /// No description provided for @ptAllMedicines.
  ///
  /// In en, this message translates to:
  /// **'All medicines'**
  String get ptAllMedicines;

  /// No description provided for @ptNoDosesToday.
  ///
  /// In en, this message translates to:
  /// **'Nothing to take today'**
  String get ptNoDosesToday;

  /// No description provided for @ptNoDosesTodayBody.
  ///
  /// In en, this message translates to:
  /// **'None of your medicines is scheduled for today.'**
  String get ptNoDosesTodayBody;

  /// No description provided for @ptNoMedicinesYet.
  ///
  /// In en, this message translates to:
  /// **'No medicines yet'**
  String get ptNoMedicinesYet;

  /// No description provided for @ptNoMedicinesYetBody.
  ///
  /// In en, this message translates to:
  /// **'Medicines your doctor prescribes appear here, with reminders.'**
  String get ptNoMedicinesYetBody;

  /// No description provided for @ptAllDosesTaken.
  ///
  /// In en, this message translates to:
  /// **'All taken'**
  String get ptAllDosesTaken;

  /// No description provided for @ptDosesMissed.
  ///
  /// In en, this message translates to:
  /// **'{count} missed'**
  String ptDosesMissed(int count);

  /// No description provided for @ptDosesTakenLate.
  ///
  /// In en, this message translates to:
  /// **'{count} taken late'**
  String ptDosesTakenLate(int count);

  /// No description provided for @ptDosesSkipped.
  ///
  /// In en, this message translates to:
  /// **'{count} skipped'**
  String ptDosesSkipped(int count);

  /// No description provided for @ptDosesTakenOf.
  ///
  /// In en, this message translates to:
  /// **'{taken} of {total} doses taken'**
  String ptDosesTakenOf(int taken, int total);

  /// No description provided for @ptDoseDueNow.
  ///
  /// In en, this message translates to:
  /// **'Due now · {time}'**
  String ptDoseDueNow(String time);

  /// No description provided for @ptNextDoseAt.
  ///
  /// In en, this message translates to:
  /// **'Next dose at {time}'**
  String ptNextDoseAt(String time);

  /// No description provided for @ptRecordThisDose.
  ///
  /// In en, this message translates to:
  /// **'Record this dose'**
  String get ptRecordThisDose;

  /// No description provided for @ptNoReadingsInDays.
  ///
  /// In en, this message translates to:
  /// **'No sugar readings in the last {days} days'**
  String ptNoReadingsInDays(int days);

  /// No description provided for @ptLastReadingDaysAgo.
  ///
  /// In en, this message translates to:
  /// **'{days, plural, =0{Last reading was today} =1{Last reading was yesterday} other{Last reading was {days} days ago}}'**
  String ptLastReadingDaysAgo(int days);

  /// No description provided for @ptSugarCheckDue.
  ///
  /// In en, this message translates to:
  /// **'Time to check your sugar'**
  String get ptSugarCheckDue;

  /// No description provided for @ptAddAReading.
  ///
  /// In en, this message translates to:
  /// **'Add a reading'**
  String get ptAddAReading;

  /// No description provided for @ptNoReadingsTryLonger.
  ///
  /// In en, this message translates to:
  /// **'No readings in the last {days} days. A longer period may show older ones.'**
  String ptNoReadingsTryLonger(int days);

  /// No description provided for @ptSugarTitle.
  ///
  /// In en, this message translates to:
  /// **'Blood sugar'**
  String get ptSugarTitle;

  /// No description provided for @ptCouldNotLoadReadings.
  ///
  /// In en, this message translates to:
  /// **'Could not load your sugar readings.'**
  String get ptCouldNotLoadReadings;

  /// No description provided for @ptOneReadingSoFar.
  ///
  /// In en, this message translates to:
  /// **'One reading so far. Your trend appears after the next one.'**
  String get ptOneReadingSoFar;

  /// No description provided for @ptRange7Days.
  ///
  /// In en, this message translates to:
  /// **'7 days'**
  String get ptRange7Days;

  /// No description provided for @ptRange14Days.
  ///
  /// In en, this message translates to:
  /// **'14 days'**
  String get ptRange14Days;

  /// No description provided for @ptRange30Days.
  ///
  /// In en, this message translates to:
  /// **'30 days'**
  String get ptRange30Days;

  /// No description provided for @ptRange3Months.
  ///
  /// In en, this message translates to:
  /// **'3 months'**
  String get ptRange3Months;

  /// No description provided for @ptRange6Months.
  ///
  /// In en, this message translates to:
  /// **'6 months'**
  String get ptRange6Months;

  /// No description provided for @ptLatestReading.
  ///
  /// In en, this message translates to:
  /// **'Latest reading'**
  String get ptLatestReading;

  /// No description provided for @ptReadingNeedsAttention.
  ///
  /// In en, this message translates to:
  /// **'Needs attention'**
  String get ptReadingNeedsAttention;

  /// No description provided for @ptReadingWellAbove.
  ///
  /// In en, this message translates to:
  /// **'Well above target'**
  String get ptReadingWellAbove;

  /// No description provided for @ptReadingAbove.
  ///
  /// In en, this message translates to:
  /// **'Above target'**
  String get ptReadingAbove;

  /// No description provided for @ptReadingBelow.
  ///
  /// In en, this message translates to:
  /// **'Below target'**
  String get ptReadingBelow;

  /// No description provided for @ptReadingInRange.
  ///
  /// In en, this message translates to:
  /// **'In target range'**
  String get ptReadingInRange;

  /// No description provided for @ptAverageOverDays.
  ///
  /// In en, this message translates to:
  /// **'{days}-day average'**
  String ptAverageOverDays(int days);

  /// No description provided for @ptEstimatedHba1c.
  ///
  /// In en, this message translates to:
  /// **'Estimated HbA1c'**
  String get ptEstimatedHba1c;

  /// No description provided for @ptEstimatedHba1cNote.
  ///
  /// In en, this message translates to:
  /// **'From your readings, not a blood test'**
  String get ptEstimatedHba1cNote;

  /// No description provided for @ptLabHba1c.
  ///
  /// In en, this message translates to:
  /// **'Lab HbA1c'**
  String get ptLabHba1c;

  /// No description provided for @ptFromABloodTest.
  ///
  /// In en, this message translates to:
  /// **'From a blood test'**
  String get ptFromABloodTest;

  /// No description provided for @ptTestedOn.
  ///
  /// In en, this message translates to:
  /// **'Tested {date}'**
  String ptTestedOn(String date);

  /// No description provided for @ptAboveYourTarget.
  ///
  /// In en, this message translates to:
  /// **'Above your target'**
  String get ptAboveYourTarget;

  /// No description provided for @ptChartDailyAverage.
  ///
  /// In en, this message translates to:
  /// **'{days, plural, =1{daily average} other{{days}-day average}}'**
  String ptChartDailyAverage(int days);

  /// No description provided for @ptChartTargetBand.
  ///
  /// In en, this message translates to:
  /// **'Target {low}–{high}'**
  String ptChartTargetBand(String low, String high);

  /// No description provided for @ptChartOutsideTarget.
  ///
  /// In en, this message translates to:
  /// **'Outside target'**
  String get ptChartOutsideTarget;

  /// No description provided for @ptChartNoReadings.
  ///
  /// In en, this message translates to:
  /// **'No readings'**
  String get ptChartNoReadings;

  /// No description provided for @ptCouldNotLoadAppointments.
  ///
  /// In en, this message translates to:
  /// **'Could not load your appointments.'**
  String get ptCouldNotLoadAppointments;

  /// No description provided for @ptFollowUpBy.
  ///
  /// In en, this message translates to:
  /// **'Your doctor asked to see you again on {date}.'**
  String ptFollowUpBy(String date);

  /// No description provided for @ptFromYourClinic.
  ///
  /// In en, this message translates to:
  /// **'From your clinic'**
  String get ptFromYourClinic;

  /// No description provided for @ptOpenChat.
  ///
  /// In en, this message translates to:
  /// **'Open chat'**
  String get ptOpenChat;

  /// No description provided for @ptRoleDoctor.
  ///
  /// In en, this message translates to:
  /// **'Doctor'**
  String get ptRoleDoctor;

  /// No description provided for @ptRoleClinicTeam.
  ///
  /// In en, this message translates to:
  /// **'Clinic team'**
  String get ptRoleClinicTeam;

  /// No description provided for @ptRoleDietician.
  ///
  /// In en, this message translates to:
  /// **'Dietician'**
  String get ptRoleDietician;

  /// No description provided for @ptVoiceMessage.
  ///
  /// In en, this message translates to:
  /// **'Voice message'**
  String get ptVoiceMessage;

  /// No description provided for @ptDietPlanTitle.
  ///
  /// In en, this message translates to:
  /// **'Your diet plan'**
  String get ptDietPlanTitle;

  /// No description provided for @ptFromName.
  ///
  /// In en, this message translates to:
  /// **'From {name}'**
  String ptFromName(String name);

  /// No description provided for @ptUpdatedOn.
  ///
  /// In en, this message translates to:
  /// **'Updated {date}'**
  String ptUpdatedOn(String date);

  /// No description provided for @ptDailyCalorieTarget.
  ///
  /// In en, this message translates to:
  /// **'Daily target: {kcal} kcal'**
  String ptDailyCalorieTarget(String kcal);

  /// No description provided for @ptSeeFullPlan.
  ///
  /// In en, this message translates to:
  /// **'See full plan'**
  String get ptSeeFullPlan;

  /// No description provided for @ptBestAvoided.
  ///
  /// In en, this message translates to:
  /// **'Best avoided'**
  String get ptBestAvoided;

  /// No description provided for @ptRecentMeals.
  ///
  /// In en, this message translates to:
  /// **'Recent meals'**
  String get ptRecentMeals;

  /// No description provided for @ptNoMealsLogged.
  ///
  /// In en, this message translates to:
  /// **'No meals logged yet'**
  String get ptNoMealsLogged;

  /// No description provided for @ptNoMealsLoggedBody.
  ///
  /// In en, this message translates to:
  /// **'A photo or a line about what you ate helps your dietician advise you.'**
  String get ptNoMealsLoggedBody;

  /// No description provided for @ptLogAMeal.
  ///
  /// In en, this message translates to:
  /// **'Log a meal'**
  String get ptLogAMeal;

  /// No description provided for @ptMealBreakfast.
  ///
  /// In en, this message translates to:
  /// **'Breakfast'**
  String get ptMealBreakfast;

  /// No description provided for @ptMealLunch.
  ///
  /// In en, this message translates to:
  /// **'Lunch'**
  String get ptMealLunch;

  /// No description provided for @ptMealDinner.
  ///
  /// In en, this message translates to:
  /// **'Dinner'**
  String get ptMealDinner;

  /// No description provided for @ptMealSnack.
  ///
  /// In en, this message translates to:
  /// **'Snack'**
  String get ptMealSnack;

  /// No description provided for @ptMealOther.
  ///
  /// In en, this message translates to:
  /// **'Meal'**
  String get ptMealOther;

  /// No description provided for @ptPhotoOnly.
  ///
  /// In en, this message translates to:
  /// **'Photo only'**
  String get ptPhotoOnly;

  /// No description provided for @ptMealHistory.
  ///
  /// In en, this message translates to:
  /// **'Meal history'**
  String get ptMealHistory;

  /// No description provided for @ptCouldNotLoadMeals.
  ///
  /// In en, this message translates to:
  /// **'Could not load your meals.'**
  String get ptCouldNotLoadMeals;

  /// No description provided for @ptDeleteMealTitle.
  ///
  /// In en, this message translates to:
  /// **'Delete this meal?'**
  String get ptDeleteMealTitle;

  /// No description provided for @ptDeleteMealBody.
  ///
  /// In en, this message translates to:
  /// **'It is removed from your log, and your dietician will no longer see it.'**
  String get ptDeleteMealBody;

  /// No description provided for @ptDeleteMeal.
  ///
  /// In en, this message translates to:
  /// **'Delete meal'**
  String get ptDeleteMeal;

  /// No description provided for @ptWhatDidYouEat.
  ///
  /// In en, this message translates to:
  /// **'What did you eat? For example: 2 rotis, dal, salad'**
  String get ptWhatDidYouEat;

  /// No description provided for @ptAddMealPhoto.
  ///
  /// In en, this message translates to:
  /// **'Add a photo of your meal'**
  String get ptAddMealPhoto;

  /// No description provided for @ptSaveMeal.
  ///
  /// In en, this message translates to:
  /// **'Save meal'**
  String get ptSaveMeal;

  /// No description provided for @ptAddPhotoOrNote.
  ///
  /// In en, this message translates to:
  /// **'Add a photo or a note first.'**
  String get ptAddPhotoOrNote;

  /// No description provided for @ptWhichMeal.
  ///
  /// In en, this message translates to:
  /// **'Which meal?'**
  String get ptWhichMeal;

  /// No description provided for @ptUploadingPhoto.
  ///
  /// In en, this message translates to:
  /// **'Uploading photo…'**
  String get ptUploadingPhoto;

  /// No description provided for @ptHealthDetailsTitle.
  ///
  /// In en, this message translates to:
  /// **'Your health details'**
  String get ptHealthDetailsTitle;

  /// No description provided for @ptCondition.
  ///
  /// In en, this message translates to:
  /// **'Condition'**
  String get ptCondition;

  /// No description provided for @ptWeight.
  ///
  /// In en, this message translates to:
  /// **'Weight'**
  String get ptWeight;

  /// No description provided for @ptHeight.
  ///
  /// In en, this message translates to:
  /// **'Height'**
  String get ptHeight;

  /// No description provided for @ptBmi.
  ///
  /// In en, this message translates to:
  /// **'BMI'**
  String get ptBmi;

  /// No description provided for @ptBloodPressure.
  ///
  /// In en, this message translates to:
  /// **'Blood pressure'**
  String get ptBloodPressure;

  /// No description provided for @ptNothingOnFile.
  ///
  /// In en, this message translates to:
  /// **'Nothing recorded yet. Add your height, weight and any allergies.'**
  String get ptNothingOnFile;

  /// No description provided for @ptAllergyWarning.
  ///
  /// In en, this message translates to:
  /// **'Tell every doctor who treats you'**
  String get ptAllergyWarning;

  /// No description provided for @ptConditionType1.
  ///
  /// In en, this message translates to:
  /// **'Type 1 diabetes'**
  String get ptConditionType1;

  /// No description provided for @ptConditionType2.
  ///
  /// In en, this message translates to:
  /// **'Type 2 diabetes'**
  String get ptConditionType2;

  /// No description provided for @ptConditionGestational.
  ///
  /// In en, this message translates to:
  /// **'Gestational diabetes'**
  String get ptConditionGestational;

  /// No description provided for @ptConditionPrediabetes.
  ///
  /// In en, this message translates to:
  /// **'Prediabetes'**
  String get ptConditionPrediabetes;

  /// No description provided for @ptConditionNone.
  ///
  /// In en, this message translates to:
  /// **'No diabetes'**
  String get ptConditionNone;

  /// No description provided for @ptWhoseRecord.
  ///
  /// In en, this message translates to:
  /// **'Whose record'**
  String get ptWhoseRecord;

  /// No description provided for @ptRelationYou.
  ///
  /// In en, this message translates to:
  /// **'You'**
  String get ptRelationYou;

  /// No description provided for @ptRelationChild.
  ///
  /// In en, this message translates to:
  /// **'Child'**
  String get ptRelationChild;

  /// No description provided for @ptRelationParent.
  ///
  /// In en, this message translates to:
  /// **'Parent'**
  String get ptRelationParent;

  /// No description provided for @ptRelationSpouse.
  ///
  /// In en, this message translates to:
  /// **'Spouse'**
  String get ptRelationSpouse;

  /// No description provided for @ptRelationFamily.
  ///
  /// In en, this message translates to:
  /// **'Family'**
  String get ptRelationFamily;

  /// No description provided for @ptCouldNotLoadMedicines.
  ///
  /// In en, this message translates to:
  /// **'Could not load your medicines.'**
  String get ptCouldNotLoadMedicines;

  /// No description provided for @ptDoseTakenLate.
  ///
  /// In en, this message translates to:
  /// **'Taken late'**
  String get ptDoseTakenLate;

  /// No description provided for @ptDoseDueNowShort.
  ///
  /// In en, this message translates to:
  /// **'Due now'**
  String get ptDoseDueNowShort;

  /// No description provided for @ptDoseLaterToday.
  ///
  /// In en, this message translates to:
  /// **'Later today'**
  String get ptDoseLaterToday;

  /// No description provided for @ptRecordDose.
  ///
  /// In en, this message translates to:
  /// **'Record'**
  String get ptRecordDose;

  /// No description provided for @ptSaving.
  ///
  /// In en, this message translates to:
  /// **'Saving…'**
  String get ptSaving;

  /// No description provided for @ptDoseNotSaved.
  ///
  /// In en, this message translates to:
  /// **'Not saved: {answer}'**
  String ptDoseNotSaved(String answer);

  /// No description provided for @ptDoseNotSavedSnack.
  ///
  /// In en, this message translates to:
  /// **'That dose was not saved. Tap Try again.'**
  String get ptDoseNotSavedSnack;

  /// No description provided for @ptYourMedicines.
  ///
  /// In en, this message translates to:
  /// **'Your medicines'**
  String get ptYourMedicines;

  /// No description provided for @ptFinishedCoursesNote.
  ///
  /// In en, this message translates to:
  /// **'Finished courses now move to Past medicines.'**
  String get ptFinishedCoursesNote;

  /// No description provided for @ptStopTaking.
  ///
  /// In en, this message translates to:
  /// **'Stop taking'**
  String get ptStopTaking;

  /// No description provided for @ptWhenNeeded.
  ///
  /// In en, this message translates to:
  /// **'Take when needed'**
  String get ptWhenNeeded;

  /// No description provided for @ptEveryOtherDay.
  ///
  /// In en, this message translates to:
  /// **'Every other day'**
  String get ptEveryOtherDay;

  /// No description provided for @ptOnDays.
  ///
  /// In en, this message translates to:
  /// **'On {days}'**
  String ptOnDays(String days);

  /// No description provided for @ptNoTimeSet.
  ///
  /// In en, this message translates to:
  /// **'No reminder time set'**
  String get ptNoTimeSet;

  /// No description provided for @ptScanPrescription.
  ///
  /// In en, this message translates to:
  /// **'Add from a prescription photo'**
  String get ptScanPrescription;

  /// No description provided for @ptStoppedByYou.
  ///
  /// In en, this message translates to:
  /// **'Stopped by you'**
  String get ptStoppedByYou;

  /// No description provided for @ptStartAgain.
  ///
  /// In en, this message translates to:
  /// **'Start again'**
  String get ptStartAgain;

  /// No description provided for @ptYouStoppedOn.
  ///
  /// In en, this message translates to:
  /// **'You stopped on {date}'**
  String ptYouStoppedOn(String date);

  /// No description provided for @ptYouStopped.
  ///
  /// In en, this message translates to:
  /// **'You stopped taking this'**
  String get ptYouStopped;

  /// No description provided for @ptPastMedicines.
  ///
  /// In en, this message translates to:
  /// **'Past medicines'**
  String get ptPastMedicines;

  /// No description provided for @ptCourseFinishedOn.
  ///
  /// In en, this message translates to:
  /// **'Course finished on {date}'**
  String ptCourseFinishedOn(String date);

  /// No description provided for @ptCourseFinished.
  ///
  /// In en, this message translates to:
  /// **'Course finished'**
  String get ptCourseFinished;

  /// No description provided for @ptStoppedByDoctorOn.
  ///
  /// In en, this message translates to:
  /// **'Stopped by your doctor on {date}'**
  String ptStoppedByDoctorOn(String date);

  /// No description provided for @ptStoppedByDoctor.
  ///
  /// In en, this message translates to:
  /// **'Stopped by your doctor'**
  String get ptStoppedByDoctor;

  /// No description provided for @ptCancelledByDoctorOn.
  ///
  /// In en, this message translates to:
  /// **'Cancelled by your doctor on {date}'**
  String ptCancelledByDoctorOn(String date);

  /// No description provided for @ptCancelledByDoctor.
  ///
  /// In en, this message translates to:
  /// **'Cancelled by your doctor'**
  String get ptCancelledByDoctor;

  /// No description provided for @ptNoLongerTaken.
  ///
  /// In en, this message translates to:
  /// **'No longer taken'**
  String get ptNoLongerTaken;

  /// No description provided for @ptViewAllCount.
  ///
  /// In en, this message translates to:
  /// **'View all {count}'**
  String ptViewAllCount(int count);

  /// No description provided for @ptAlsoPrescribedElsewhere.
  ///
  /// In en, this message translates to:
  /// **'Also prescribed by another clinic: {what}. Ask your doctor before taking both.'**
  String ptAlsoPrescribedElsewhere(String what);

  /// No description provided for @ptAlsoOnYourList.
  ///
  /// In en, this message translates to:
  /// **'Also on your list: {what}. Ask your doctor before taking both.'**
  String ptAlsoOnYourList(String what);

  /// No description provided for @ptRecordsAndReminders.
  ///
  /// In en, this message translates to:
  /// **'Records and reminders'**
  String get ptRecordsAndReminders;

  /// No description provided for @ptPrescriptionsSub.
  ///
  /// In en, this message translates to:
  /// **'View and share what your doctor wrote'**
  String get ptPrescriptionsSub;

  /// No description provided for @ptReminderTimes.
  ///
  /// In en, this message translates to:
  /// **'Reminder times'**
  String get ptReminderTimes;

  /// No description provided for @ptMealTimesLine.
  ///
  /// In en, this message translates to:
  /// **'Breakfast {breakfast}, lunch {lunch}, dinner {dinner}'**
  String ptMealTimesLine(String breakfast, String lunch, String dinner);

  /// No description provided for @ptDoseHistory.
  ///
  /// In en, this message translates to:
  /// **'Dose history'**
  String get ptDoseHistory;

  /// No description provided for @ptDoseHistorySub.
  ///
  /// In en, this message translates to:
  /// **'What you took, day by day'**
  String get ptDoseHistorySub;

  /// No description provided for @ptRemindersOffTitle.
  ///
  /// In en, this message translates to:
  /// **'Your medicine reminders are off'**
  String get ptRemindersOffTitle;

  /// No description provided for @ptRemindersOffBody.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{You have 1 reminder set up, but this phone will not show it.} other{You have {count} reminders set up, but this phone will not show any of them.}}'**
  String ptRemindersOffBody(int count);

  /// No description provided for @ptNotificationsBlockedTitle.
  ///
  /// In en, this message translates to:
  /// **'Notifications are blocked'**
  String get ptNotificationsBlockedTitle;

  /// No description provided for @ptNotificationsBlockedBody.
  ///
  /// In en, this message translates to:
  /// **'Reminders cannot appear until notifications are allowed for this app.'**
  String get ptNotificationsBlockedBody;

  /// No description provided for @ptRemindersLateTitle.
  ///
  /// In en, this message translates to:
  /// **'Reminders may arrive late'**
  String get ptRemindersLateTitle;

  /// No description provided for @ptRemindersLateBody.
  ///
  /// In en, this message translates to:
  /// **'Exact alarms are not allowed, so a reminder can come a few minutes after its time.'**
  String get ptRemindersLateBody;

  /// No description provided for @ptTurnRemindersOn.
  ///
  /// In en, this message translates to:
  /// **'Turn reminders back on'**
  String get ptTurnRemindersOn;

  /// No description provided for @ptRemindersSet.
  ///
  /// In en, this message translates to:
  /// **'Reminders are set.'**
  String get ptRemindersSet;

  /// No description provided for @ptRemindersStillOff.
  ///
  /// In en, this message translates to:
  /// **'Still not set. Open Settings, then Apps, then {app}, and allow notifications, alarms and background activity.'**
  String ptRemindersStillOff(String app);

  /// No description provided for @ptDidYouTakeThisDose.
  ///
  /// In en, this message translates to:
  /// **'Did you take this dose?'**
  String get ptDidYouTakeThisDose;

  /// No description provided for @ptYesTookIt.
  ///
  /// In en, this message translates to:
  /// **'Yes, I took it'**
  String get ptYesTookIt;

  /// No description provided for @ptNoSkippedIt.
  ///
  /// In en, this message translates to:
  /// **'No, I skipped it'**
  String get ptNoSkippedIt;

  /// No description provided for @ptSkipHonestyNote.
  ///
  /// In en, this message translates to:
  /// **'Your answer helps your doctor. A skipped dose is nothing to hide.'**
  String get ptSkipHonestyNote;

  /// No description provided for @ptNoReason.
  ///
  /// In en, this message translates to:
  /// **'No reason'**
  String get ptNoReason;

  /// No description provided for @ptStopTakingQuestion.
  ///
  /// In en, this message translates to:
  /// **'Stop taking {name}?'**
  String ptStopTakingQuestion(String name);

  /// No description provided for @ptStopPatientOwnedBody.
  ///
  /// In en, this message translates to:
  /// **'Its reminders stop. You can start it again later.'**
  String get ptStopPatientOwnedBody;

  /// No description provided for @ptStopPrescribedBody.
  ///
  /// In en, this message translates to:
  /// **'Its reminders stop. Your doctor\'s prescription stays as they wrote it, and they will see that you stopped. You can start again later.'**
  String get ptStopPrescribedBody;

  /// No description provided for @ptStopSideEffectNote.
  ///
  /// In en, this message translates to:
  /// **'If a side effect is worrying you, contact your clinic.'**
  String get ptStopSideEffectNote;

  /// No description provided for @ptReasonSideEffects.
  ///
  /// In en, this message translates to:
  /// **'Side effects'**
  String get ptReasonSideEffects;

  /// No description provided for @ptReasonRanOut.
  ///
  /// In en, this message translates to:
  /// **'Ran out'**
  String get ptReasonRanOut;

  /// No description provided for @ptReasonFeelingBetter.
  ///
  /// In en, this message translates to:
  /// **'Feeling better'**
  String get ptReasonFeelingBetter;

  /// No description provided for @ptReasonDoctorTold.
  ///
  /// In en, this message translates to:
  /// **'My doctor told me to'**
  String get ptReasonDoctorTold;

  /// No description provided for @ptWhyStopping.
  ///
  /// In en, this message translates to:
  /// **'Why are you stopping? (optional)'**
  String get ptWhyStopping;

  /// No description provided for @ptKeepTaking.
  ///
  /// In en, this message translates to:
  /// **'Keep taking it'**
  String get ptKeepTaking;

  /// No description provided for @ptYouStoppedTaking.
  ///
  /// In en, this message translates to:
  /// **'You stopped taking {name}.'**
  String ptYouStoppedTaking(String name);

  /// No description provided for @ptYouStoppedTakingDoctorSees.
  ///
  /// In en, this message translates to:
  /// **'You stopped taking {name}. Your doctor will see this.'**
  String ptYouStoppedTakingDoctorSees(String name);

  /// No description provided for @ptRemindersBackOn.
  ///
  /// In en, this message translates to:
  /// **'Reminders for {name} are back on.'**
  String ptRemindersBackOn(String name);

  /// No description provided for @ptCouldNotLoadHistory.
  ///
  /// In en, this message translates to:
  /// **'Could not load your dose history.'**
  String get ptCouldNotLoadHistory;

  /// No description provided for @ptNoDosesInPeriod.
  ///
  /// In en, this message translates to:
  /// **'No doses in this period'**
  String get ptNoDosesInPeriod;

  /// No description provided for @ptTakenOfTotal.
  ///
  /// In en, this message translates to:
  /// **'{taken} of {total} taken'**
  String ptTakenOfTotal(int taken, int total);

  /// No description provided for @ptTakenAt.
  ///
  /// In en, this message translates to:
  /// **'Taken at {time}'**
  String ptTakenAt(String time);

  /// No description provided for @ptTakenLateAt.
  ///
  /// In en, this message translates to:
  /// **'Taken late, at {time}'**
  String ptTakenLateAt(String time);

  /// No description provided for @ptITookThisOne.
  ///
  /// In en, this message translates to:
  /// **'I took this one'**
  String get ptITookThisOne;

  /// No description provided for @ptCouldNotSaveDose.
  ///
  /// In en, this message translates to:
  /// **'Could not save this dose. Try again.'**
  String get ptCouldNotSaveDose;

  /// No description provided for @ptYou.
  ///
  /// In en, this message translates to:
  /// **'You'**
  String get ptYou;

  /// No description provided for @ptAssistantName.
  ///
  /// In en, this message translates to:
  /// **'Assistant'**
  String get ptAssistantName;

  /// No description provided for @ptHealthAssistant.
  ///
  /// In en, this message translates to:
  /// **'Health assistant'**
  String get ptHealthAssistant;

  /// No description provided for @ptYourClinic.
  ///
  /// In en, this message translates to:
  /// **'Your clinic'**
  String get ptYourClinic;

  /// No description provided for @ptRequestAppointment.
  ///
  /// In en, this message translates to:
  /// **'Ask for an appointment'**
  String get ptRequestAppointment;

  /// No description provided for @ptRequestSent.
  ///
  /// In en, this message translates to:
  /// **'Request sent. The clinic will confirm a time and let you know.'**
  String get ptRequestSent;

  /// No description provided for @ptEdited.
  ///
  /// In en, this message translates to:
  /// **'edited'**
  String get ptEdited;

  /// No description provided for @ptEditWindowNote.
  ///
  /// In en, this message translates to:
  /// **'Within 15 minutes. The other side sees it was edited.'**
  String get ptEditWindowNote;

  /// No description provided for @ptNotSent.
  ///
  /// In en, this message translates to:
  /// **'Your message was not sent'**
  String get ptNotSent;

  /// No description provided for @ptAttachDocument.
  ///
  /// In en, this message translates to:
  /// **'Document'**
  String get ptAttachDocument;

  /// No description provided for @ptAttachDocumentSub.
  ///
  /// In en, this message translates to:
  /// **'PDF, Word, Excel or text'**
  String get ptAttachDocumentSub;

  /// No description provided for @ptCouldNotPlayVoice.
  ///
  /// In en, this message translates to:
  /// **'Could not play this voice message'**
  String get ptCouldNotPlayVoice;

  /// No description provided for @ptCancelReply.
  ///
  /// In en, this message translates to:
  /// **'Cancel reply'**
  String get ptCancelReply;

  /// No description provided for @ptPlaySpeed.
  ///
  /// In en, this message translates to:
  /// **'Playback speed'**
  String get ptPlaySpeed;

  /// No description provided for @ptMessageDietician.
  ///
  /// In en, this message translates to:
  /// **'Message your dietician'**
  String get ptMessageDietician;

  /// No description provided for @ptNoDieticianYet.
  ///
  /// In en, this message translates to:
  /// **'Not assigned yet · a dietician will reply'**
  String get ptNoDieticianYet;

  /// No description provided for @ptYourDieticianSub.
  ///
  /// In en, this message translates to:
  /// **'Your dietician · Food and nutrition'**
  String get ptYourDieticianSub;

  /// No description provided for @ptAskDieticianBody.
  ///
  /// In en, this message translates to:
  /// **'Ask your dietician about food, portions or your plan.'**
  String get ptAskDieticianBody;

  /// No description provided for @ptAttachment.
  ///
  /// In en, this message translates to:
  /// **'Attachment'**
  String get ptAttachment;

  /// No description provided for @ptClinicAlertedEmergency.
  ///
  /// In en, this message translates to:
  /// **'This looks urgent — the clinic has been told. If you feel unwell now, call them.'**
  String get ptClinicAlertedEmergency;

  /// No description provided for @ptClinicAlerted.
  ///
  /// In en, this message translates to:
  /// **'The clinic has been told about this message.'**
  String get ptClinicAlerted;

  /// No description provided for @ptTestsTitle.
  ///
  /// In en, this message translates to:
  /// **'Tests and reports'**
  String get ptTestsTitle;

  /// No description provided for @ptAskedForByDoctor.
  ///
  /// In en, this message translates to:
  /// **'Asked for by your doctor'**
  String get ptAskedForByDoctor;

  /// No description provided for @ptNoTestsAdvised.
  ///
  /// In en, this message translates to:
  /// **'No tests asked for yet. Your doctor adds them when they prescribe.'**
  String get ptNoTestsAdvised;

  /// No description provided for @ptReportUploadedStatus.
  ///
  /// In en, this message translates to:
  /// **'Report uploaded'**
  String get ptReportUploadedStatus;

  /// No description provided for @ptNotUploadedYet.
  ///
  /// In en, this message translates to:
  /// **'Not uploaded yet'**
  String get ptNotUploadedYet;

  /// No description provided for @ptUpload.
  ///
  /// In en, this message translates to:
  /// **'Upload'**
  String get ptUpload;

  /// No description provided for @ptUploadAgain.
  ///
  /// In en, this message translates to:
  /// **'Upload again'**
  String get ptUploadAgain;

  /// No description provided for @ptYourReports.
  ///
  /// In en, this message translates to:
  /// **'Your reports'**
  String get ptYourReports;

  /// No description provided for @ptNoReportsYet.
  ///
  /// In en, this message translates to:
  /// **'Reports you upload appear here. Your doctor and dietician can see them.'**
  String get ptNoReportsYet;

  /// No description provided for @ptReadingReport.
  ///
  /// In en, this message translates to:
  /// **'Reading your report…'**
  String get ptReadingReport;

  /// No description provided for @ptCouldNotReadReport.
  ///
  /// In en, this message translates to:
  /// **'Could not be read'**
  String get ptCouldNotReadReport;

  /// No description provided for @ptFlaggedOnReport.
  ///
  /// In en, this message translates to:
  /// **'Out of range on the report: {list}'**
  String ptFlaggedOnReport(String list);

  /// No description provided for @ptDeleteReportTitle.
  ///
  /// In en, this message translates to:
  /// **'Delete this {name} report?'**
  String ptDeleteReportTitle(String name);

  /// No description provided for @ptDeleteReportBody.
  ///
  /// In en, this message translates to:
  /// **'It is removed from your record, with any readings the clinic took from it. You can upload the right file afterwards.'**
  String get ptDeleteReportBody;

  /// No description provided for @ptDeleteReport.
  ///
  /// In en, this message translates to:
  /// **'Delete report'**
  String get ptDeleteReport;

  /// No description provided for @ptReportDeleted.
  ///
  /// In en, this message translates to:
  /// **'Report deleted'**
  String get ptReportDeleted;

  /// No description provided for @ptReportUploaded.
  ///
  /// In en, this message translates to:
  /// **'{name} report uploaded'**
  String ptReportUploaded(String name);

  /// No description provided for @ptUploadAReport.
  ///
  /// In en, this message translates to:
  /// **'Upload a report'**
  String get ptUploadAReport;

  /// No description provided for @ptPdfOrDocument.
  ///
  /// In en, this message translates to:
  /// **'PDF or document'**
  String get ptPdfOrDocument;

  /// No description provided for @ptPdfOrDocumentSub.
  ///
  /// In en, this message translates to:
  /// **'The report your lab sent you'**
  String get ptPdfOrDocumentSub;

  /// No description provided for @ptWhichTest.
  ///
  /// In en, this message translates to:
  /// **'Which test is this?'**
  String get ptWhichTest;

  /// No description provided for @ptOrTypeTestName.
  ///
  /// In en, this message translates to:
  /// **'Or type the test name'**
  String get ptOrTypeTestName;

  /// No description provided for @ptTestNameHint.
  ///
  /// In en, this message translates to:
  /// **'For example: HbA1c, lipid profile'**
  String get ptTestNameHint;

  /// No description provided for @ptCouldNotLoadTests.
  ///
  /// In en, this message translates to:
  /// **'Could not load your tests.'**
  String get ptCouldNotLoadTests;

  /// No description provided for @ptUploading.
  ///
  /// In en, this message translates to:
  /// **'Uploading…'**
  String get ptUploading;

  /// No description provided for @ptCouldNotLoadPrescriptions.
  ///
  /// In en, this message translates to:
  /// **'Could not load your prescriptions.'**
  String get ptCouldNotLoadPrescriptions;

  /// No description provided for @ptNoPrescriptionsYet.
  ///
  /// In en, this message translates to:
  /// **'No prescriptions yet'**
  String get ptNoPrescriptionsYet;

  /// No description provided for @ptNoPrescriptionsYetBody.
  ///
  /// In en, this message translates to:
  /// **'They appear here once your doctor writes one.'**
  String get ptNoPrescriptionsYetBody;

  /// No description provided for @ptMedicineCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No medicines} =1{1 medicine} other{{count} medicines}}'**
  String ptMedicineCount(int count);

  /// No description provided for @ptUndated.
  ///
  /// In en, this message translates to:
  /// **'No date'**
  String get ptUndated;

  /// No description provided for @ptByName.
  ///
  /// In en, this message translates to:
  /// **'By {name}'**
  String ptByName(String name);

  /// No description provided for @ptOpenPdf.
  ///
  /// In en, this message translates to:
  /// **'Open PDF'**
  String get ptOpenPdf;

  /// No description provided for @ptShare.
  ///
  /// In en, this message translates to:
  /// **'Share'**
  String get ptShare;

  /// No description provided for @ptCouldNotOpenPrescription.
  ///
  /// In en, this message translates to:
  /// **'Could not open the prescription.'**
  String get ptCouldNotOpenPrescription;

  /// No description provided for @ptCouldNotSharePrescription.
  ///
  /// In en, this message translates to:
  /// **'Could not share the prescription.'**
  String get ptCouldNotSharePrescription;

  /// No description provided for @ptComplaint.
  ///
  /// In en, this message translates to:
  /// **'Complaint'**
  String get ptComplaint;

  /// No description provided for @ptDiagnosis.
  ///
  /// In en, this message translates to:
  /// **'Diagnosis'**
  String get ptDiagnosis;

  /// No description provided for @ptTestsAdvised.
  ///
  /// In en, this message translates to:
  /// **'Tests advised'**
  String get ptTestsAdvised;

  /// No description provided for @ptAdvice.
  ///
  /// In en, this message translates to:
  /// **'Advice'**
  String get ptAdvice;

  /// No description provided for @ptFollowUp.
  ///
  /// In en, this message translates to:
  /// **'Follow-up'**
  String get ptFollowUp;

  /// No description provided for @ptForDays.
  ///
  /// In en, this message translates to:
  /// **'{days, plural, =1{for 1 day} other{for {days} days}}'**
  String ptForDays(int days);

  /// No description provided for @ptYourInformation.
  ///
  /// In en, this message translates to:
  /// **'Your information'**
  String get ptYourInformation;

  /// No description provided for @ptHelp.
  ///
  /// In en, this message translates to:
  /// **'Help'**
  String get ptHelp;

  /// No description provided for @ptVersion.
  ///
  /// In en, this message translates to:
  /// **'Version {version}'**
  String ptVersion(String version);

  /// No description provided for @ptViewLicences.
  ///
  /// In en, this message translates to:
  /// **'View licences'**
  String get ptViewLicences;

  /// No description provided for @ptAboutLine.
  ///
  /// In en, this message translates to:
  /// **'Your care, on your phone.'**
  String get ptAboutLine;

  /// No description provided for @ptCheckInReminders.
  ///
  /// In en, this message translates to:
  /// **'Sugar check reminders'**
  String get ptCheckInReminders;

  /// No description provided for @ptCheckInRemindersSub.
  ///
  /// In en, this message translates to:
  /// **'A reminder when you have not logged a reading for 3 days'**
  String get ptCheckInRemindersSub;

  /// No description provided for @ptReminderReliability.
  ///
  /// In en, this message translates to:
  /// **'Make reminders reliable'**
  String get ptReminderReliability;

  /// No description provided for @ptReminderReliabilitySub.
  ///
  /// In en, this message translates to:
  /// **'Keep dose alarms working when the phone sleeps'**
  String get ptReminderReliabilitySub;

  /// No description provided for @ptClinicMessagesNote.
  ///
  /// In en, this message translates to:
  /// **'Messages from your clinic always arrive. To silence them, use your phone\'s notification settings.'**
  String get ptClinicMessagesNote;

  /// No description provided for @ptSetByDoctor.
  ///
  /// In en, this message translates to:
  /// **'Set by your doctor from your diagnosis'**
  String get ptSetByDoctor;

  /// No description provided for @ptMostRecentMeasurements.
  ///
  /// In en, this message translates to:
  /// **'Your most recent measurements. Recording a new one updates them.'**
  String get ptMostRecentMeasurements;

  /// No description provided for @ptNumberBetween.
  ///
  /// In en, this message translates to:
  /// **'Enter a number between {low} and {high}'**
  String ptNumberBetween(String low, String high);

  /// No description provided for @medsLast30Days.
  ///
  /// In en, this message translates to:
  /// **'Last 30 days'**
  String get medsLast30Days;

  /// No description provided for @careTitle.
  ///
  /// In en, this message translates to:
  /// **'Care'**
  String get careTitle;

  /// No description provided for @careFootCare.
  ///
  /// In en, this message translates to:
  /// **'Foot Care'**
  String get careFootCare;

  /// No description provided for @careFootCareDesc.
  ///
  /// In en, this message translates to:
  /// **'Track wound checks and foot health'**
  String get careFootCareDesc;

  /// No description provided for @careEyeCare.
  ///
  /// In en, this message translates to:
  /// **'Eye Care'**
  String get careEyeCare;

  /// No description provided for @careEyeCareDesc.
  ///
  /// In en, this message translates to:
  /// **'Retinal screening reports and guidance'**
  String get careEyeCareDesc;

  /// No description provided for @careAppointments.
  ///
  /// In en, this message translates to:
  /// **'Appointments'**
  String get careAppointments;

  /// No description provided for @careAppointmentsDesc.
  ///
  /// In en, this message translates to:
  /// **'Book and manage clinic visits'**
  String get careAppointmentsDesc;

  /// No description provided for @carePrescriptions.
  ///
  /// In en, this message translates to:
  /// **'Prescriptions'**
  String get carePrescriptions;

  /// No description provided for @carePrescriptionsDesc.
  ///
  /// In en, this message translates to:
  /// **'View prescriptions from your doctor'**
  String get carePrescriptionsDesc;

  /// No description provided for @careLabReports.
  ///
  /// In en, this message translates to:
  /// **'Lab Reports'**
  String get careLabReports;

  /// No description provided for @careLabReportsDesc.
  ///
  /// In en, this message translates to:
  /// **'Your lab test results'**
  String get careLabReportsDesc;

  /// No description provided for @profileTitle.
  ///
  /// In en, this message translates to:
  /// **'Profile'**
  String get profileTitle;

  /// No description provided for @profileLanguage.
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get profileLanguage;

  /// No description provided for @profileLogout.
  ///
  /// In en, this message translates to:
  /// **'Log out'**
  String get profileLogout;

  /// No description provided for @profileEditProfile.
  ///
  /// In en, this message translates to:
  /// **'Edit profile'**
  String get profileEditProfile;

  /// No description provided for @profileAbout.
  ///
  /// In en, this message translates to:
  /// **'About MedPin'**
  String get profileAbout;

  /// No description provided for @profilePatient.
  ///
  /// In en, this message translates to:
  /// **'Patient'**
  String get profilePatient;

  /// No description provided for @profileAppearance.
  ///
  /// In en, this message translates to:
  /// **'Appearance'**
  String get profileAppearance;

  /// No description provided for @profileThemeLight.
  ///
  /// In en, this message translates to:
  /// **'Light'**
  String get profileThemeLight;

  /// No description provided for @profileThemeDark.
  ///
  /// In en, this message translates to:
  /// **'Dark'**
  String get profileThemeDark;

  /// No description provided for @profileThemeSystem.
  ///
  /// In en, this message translates to:
  /// **'System'**
  String get profileThemeSystem;

  /// No description provided for @profileAccount.
  ///
  /// In en, this message translates to:
  /// **'Account'**
  String get profileAccount;

  /// No description provided for @profileClinic.
  ///
  /// In en, this message translates to:
  /// **'Clinic'**
  String get profileClinic;

  /// No description provided for @profileSupport.
  ///
  /// In en, this message translates to:
  /// **'Support'**
  String get profileSupport;

  /// No description provided for @profileDiabetesType.
  ///
  /// In en, this message translates to:
  /// **'Diabetes type'**
  String get profileDiabetesType;

  /// No description provided for @profileDiabetesTypeNotSet.
  ///
  /// In en, this message translates to:
  /// **'Not set'**
  String get profileDiabetesTypeNotSet;

  /// No description provided for @profileNotifications.
  ///
  /// In en, this message translates to:
  /// **'Notifications'**
  String get profileNotifications;

  /// No description provided for @profileCallClinic.
  ///
  /// In en, this message translates to:
  /// **'Call clinic'**
  String get profileCallClinic;

  /// No description provided for @profileFooter.
  ///
  /// In en, this message translates to:
  /// **'Carefully made for your wellbeing'**
  String get profileFooter;

  /// No description provided for @profileSave.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get profileSave;

  /// No description provided for @profileSaved.
  ///
  /// In en, this message translates to:
  /// **'Your details have been updated'**
  String get profileSaved;

  /// No description provided for @profilePhoneLocked.
  ///
  /// In en, this message translates to:
  /// **'Your phone number is your login and cannot be changed here. Please contact the clinic if it needs updating.'**
  String get profilePhoneLocked;

  /// No description provided for @profileChangePhoto.
  ///
  /// In en, this message translates to:
  /// **'Change photo'**
  String get profileChangePhoto;

  /// No description provided for @profileDiabetesSheetTitle.
  ///
  /// In en, this message translates to:
  /// **'Your diabetes type'**
  String get profileDiabetesSheetTitle;

  /// No description provided for @profileDiabetesSheetBody.
  ///
  /// In en, this message translates to:
  /// **'This helps the assistant give you the right guidance. Ask your doctor if you are not sure.'**
  String get profileDiabetesSheetBody;

  /// No description provided for @profileDiabetesType1Desc.
  ///
  /// In en, this message translates to:
  /// **'The body makes no insulin'**
  String get profileDiabetesType1Desc;

  /// No description provided for @profileDiabetesType2Desc.
  ///
  /// In en, this message translates to:
  /// **'Insulin is not used well'**
  String get profileDiabetesType2Desc;

  /// No description provided for @profileDiabetesGestationalDesc.
  ///
  /// In en, this message translates to:
  /// **'Occurs during pregnancy'**
  String get profileDiabetesGestationalDesc;

  /// No description provided for @profileDiabetesPrediabetesDesc.
  ///
  /// In en, this message translates to:
  /// **'Glucose above normal, below diabetes'**
  String get profileDiabetesPrediabetesDesc;

  /// No description provided for @profileDiabetesNoneDesc.
  ///
  /// In en, this message translates to:
  /// **'Not diabetic'**
  String get profileDiabetesNoneDesc;

  /// Push delivery is stubbed server-side; say so plainly rather than implying reminders will arrive
  ///
  /// In en, this message translates to:
  /// **'Alerts from the clinic are not yet delivered to this device. Your doctor still sees every alert you raise.'**
  String get profileNotificationsBody;

  /// No description provided for @profilePreferences.
  ///
  /// In en, this message translates to:
  /// **'Preferences'**
  String get profilePreferences;

  /// No description provided for @profileSecurity.
  ///
  /// In en, this message translates to:
  /// **'Security'**
  String get profileSecurity;

  /// No description provided for @profileHealthDetails.
  ///
  /// In en, this message translates to:
  /// **'Health details'**
  String get profileHealthDetails;

  /// No description provided for @profileGlucoseUnit.
  ///
  /// In en, this message translates to:
  /// **'Glucose unit'**
  String get profileGlucoseUnit;

  /// No description provided for @profileAppLock.
  ///
  /// In en, this message translates to:
  /// **'App lock'**
  String get profileAppLock;

  /// No description provided for @profileAppLockSub.
  ///
  /// In en, this message translates to:
  /// **'Require your fingerprint, face or device PIN to open the app'**
  String get profileAppLockSub;

  /// No description provided for @notifMedicationReminders.
  ///
  /// In en, this message translates to:
  /// **'Medication reminders'**
  String get notifMedicationReminders;

  /// No description provided for @notifMedicationRemindersSub.
  ///
  /// In en, this message translates to:
  /// **'Nudge me when a dose is due'**
  String get notifMedicationRemindersSub;

  /// No description provided for @notifAppointmentAlerts.
  ///
  /// In en, this message translates to:
  /// **'Appointment reminders'**
  String get notifAppointmentAlerts;

  /// No description provided for @notifAppointmentAlertsSub.
  ///
  /// In en, this message translates to:
  /// **'Remind me before a visit'**
  String get notifAppointmentAlertsSub;

  /// No description provided for @notifClinicAlerts.
  ///
  /// In en, this message translates to:
  /// **'Clinic messages'**
  String get notifClinicAlerts;

  /// No description provided for @notifClinicAlertsSub.
  ///
  /// In en, this message translates to:
  /// **'Replies and follow-ups from the clinic'**
  String get notifClinicAlertsSub;

  /// No description provided for @notifDeliveryNote.
  ///
  /// In en, this message translates to:
  /// **'Your notification settings are saved and will apply as soon as alerts start arriving on this phone. Your doctor already sees everything you raise.'**
  String get notifDeliveryNote;

  /// No description provided for @healthHeight.
  ///
  /// In en, this message translates to:
  /// **'Height (cm)'**
  String get healthHeight;

  /// No description provided for @healthWeight.
  ///
  /// In en, this message translates to:
  /// **'Weight (kg)'**
  String get healthWeight;

  /// No description provided for @healthDiagnosedOn.
  ///
  /// In en, this message translates to:
  /// **'Diagnosed on'**
  String get healthDiagnosedOn;

  /// No description provided for @healthAllergies.
  ///
  /// In en, this message translates to:
  /// **'Allergies'**
  String get healthAllergies;

  /// No description provided for @healthAllergiesHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. Penicillin, Sulfa'**
  String get healthAllergiesHint;

  /// No description provided for @healthMainConcern.
  ///
  /// In en, this message translates to:
  /// **'Main concern'**
  String get healthMainConcern;

  /// No description provided for @healthMainConcernHint.
  ///
  /// In en, this message translates to:
  /// **'What\'s troubling you most right now'**
  String get healthMainConcernHint;

  /// No description provided for @healthEmergencyContact.
  ///
  /// In en, this message translates to:
  /// **'Emergency contact'**
  String get healthEmergencyContact;

  /// No description provided for @healthContactName.
  ///
  /// In en, this message translates to:
  /// **'Contact name'**
  String get healthContactName;

  /// No description provided for @healthContactPhone.
  ///
  /// In en, this message translates to:
  /// **'Contact phone'**
  String get healthContactPhone;

  /// No description provided for @healthContactRelation.
  ///
  /// In en, this message translates to:
  /// **'Relationship'**
  String get healthContactRelation;

  /// No description provided for @healthNotSet.
  ///
  /// In en, this message translates to:
  /// **'Not set'**
  String get healthNotSet;

  /// No description provided for @appLockEnable.
  ///
  /// In en, this message translates to:
  /// **'Unlock with fingerprint or face'**
  String get appLockEnable;

  /// No description provided for @appLockUnavailable.
  ///
  /// In en, this message translates to:
  /// **'This device has no fingerprint or face unlock set up.'**
  String get appLockUnavailable;

  /// No description provided for @appLockPrompt.
  ///
  /// In en, this message translates to:
  /// **'Unlock MedPin'**
  String get appLockPrompt;

  /// No description provided for @appLockLocked.
  ///
  /// In en, this message translates to:
  /// **'MedPin is locked'**
  String get appLockLocked;

  /// No description provided for @appLockUnlock.
  ///
  /// In en, this message translates to:
  /// **'Unlock'**
  String get appLockUnlock;

  /// No description provided for @apptTitle.
  ///
  /// In en, this message translates to:
  /// **'Appointments'**
  String get apptTitle;

  /// No description provided for @apptBook.
  ///
  /// In en, this message translates to:
  /// **'Book appointment'**
  String get apptBook;

  /// No description provided for @apptUpcoming.
  ///
  /// In en, this message translates to:
  /// **'Upcoming'**
  String get apptUpcoming;

  /// No description provided for @apptPast.
  ///
  /// In en, this message translates to:
  /// **'Past'**
  String get apptPast;

  /// No description provided for @apptNoUpcoming.
  ///
  /// In en, this message translates to:
  /// **'No upcoming appointments'**
  String get apptNoUpcoming;

  /// No description provided for @apptNoUpcomingBody.
  ///
  /// In en, this message translates to:
  /// **'Book a visit with the clinic and it will appear here.'**
  String get apptNoUpcomingBody;

  /// No description provided for @apptNoPast.
  ///
  /// In en, this message translates to:
  /// **'No past appointments'**
  String get apptNoPast;

  /// No description provided for @apptChooseClinic.
  ///
  /// In en, this message translates to:
  /// **'Choose a clinic'**
  String get apptChooseClinic;

  /// No description provided for @apptChooseDate.
  ///
  /// In en, this message translates to:
  /// **'Choose a date'**
  String get apptChooseDate;

  /// No description provided for @apptChooseTime.
  ///
  /// In en, this message translates to:
  /// **'Choose a time'**
  String get apptChooseTime;

  /// No description provided for @apptNoSlots.
  ///
  /// In en, this message translates to:
  /// **'No available times on this day'**
  String get apptNoSlots;

  /// No description provided for @apptClosedThatDay.
  ///
  /// In en, this message translates to:
  /// **'The clinic is closed on this day'**
  String get apptClosedThatDay;

  /// No description provided for @apptNotifyMeLater.
  ///
  /// In en, this message translates to:
  /// **'Notify me if a slot opens'**
  String get apptNotifyMeLater;

  /// No description provided for @apptWaitlistJoined.
  ///
  /// In en, this message translates to:
  /// **'We\'ll notify you if a slot opens'**
  String get apptWaitlistJoined;

  /// No description provided for @apptReasonLabel.
  ///
  /// In en, this message translates to:
  /// **'Reason for visit (optional)'**
  String get apptReasonLabel;

  /// No description provided for @apptReasonHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. Follow-up, sugar review'**
  String get apptReasonHint;

  /// No description provided for @apptConfirmBooking.
  ///
  /// In en, this message translates to:
  /// **'Confirm booking'**
  String get apptConfirmBooking;

  /// No description provided for @apptBookedTitle.
  ///
  /// In en, this message translates to:
  /// **'Appointment confirmed'**
  String get apptBookedTitle;

  /// No description provided for @apptBookedBody.
  ///
  /// In en, this message translates to:
  /// **'Your appointment is confirmed. You\'ll find it under Upcoming.'**
  String get apptBookedBody;

  /// No description provided for @apptCancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel appointment'**
  String get apptCancel;

  /// No description provided for @apptCancelConfirm.
  ///
  /// In en, this message translates to:
  /// **'Cancel this appointment?'**
  String get apptCancelConfirm;

  /// No description provided for @apptCancelConfirmBody.
  ///
  /// In en, this message translates to:
  /// **'The time slot will be released for others.'**
  String get apptCancelConfirmBody;

  /// No description provided for @apptCancelled.
  ///
  /// In en, this message translates to:
  /// **'Appointment cancelled'**
  String get apptCancelled;

  /// No description provided for @apptReschedule.
  ///
  /// In en, this message translates to:
  /// **'Reschedule'**
  String get apptReschedule;

  /// No description provided for @apptCall.
  ///
  /// In en, this message translates to:
  /// **'Call clinic'**
  String get apptCall;

  /// No description provided for @apptDirections.
  ///
  /// In en, this message translates to:
  /// **'Directions'**
  String get apptDirections;

  /// No description provided for @apptStatusRequested.
  ///
  /// In en, this message translates to:
  /// **'Requested'**
  String get apptStatusRequested;

  /// No description provided for @apptStatusConfirmed.
  ///
  /// In en, this message translates to:
  /// **'Confirmed'**
  String get apptStatusConfirmed;

  /// No description provided for @apptStatusCheckedIn.
  ///
  /// In en, this message translates to:
  /// **'Checked in'**
  String get apptStatusCheckedIn;

  /// No description provided for @apptStatusInConsultation.
  ///
  /// In en, this message translates to:
  /// **'In consultation'**
  String get apptStatusInConsultation;

  /// No description provided for @apptStatusCompleted.
  ///
  /// In en, this message translates to:
  /// **'Completed'**
  String get apptStatusCompleted;

  /// No description provided for @apptStatusCancelled.
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get apptStatusCancelled;

  /// No description provided for @apptStatusNoShow.
  ///
  /// In en, this message translates to:
  /// **'Missed'**
  String get apptStatusNoShow;

  /// No description provided for @apptModeInClinic.
  ///
  /// In en, this message translates to:
  /// **'In clinic'**
  String get apptModeInClinic;

  /// No description provided for @apptModeTeleconsult.
  ///
  /// In en, this message translates to:
  /// **'Video consult'**
  String get apptModeTeleconsult;

  /// No description provided for @apptSlotTaken.
  ///
  /// In en, this message translates to:
  /// **'That time was just taken. Please pick another.'**
  String get apptSlotTaken;

  /// No description provided for @apptBookingFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not book. Please try again.'**
  String get apptBookingFailed;

  /// No description provided for @apptSelectSlotFirst.
  ///
  /// In en, this message translates to:
  /// **'Please choose a time first'**
  String get apptSelectSlotFirst;

  /// No description provided for @msgClinicTitle.
  ///
  /// In en, this message translates to:
  /// **'Message the clinic'**
  String get msgClinicTitle;

  /// No description provided for @msgComposerHint.
  ///
  /// In en, this message translates to:
  /// **'Write a message…'**
  String get msgComposerHint;

  /// No description provided for @msgEmpty.
  ///
  /// In en, this message translates to:
  /// **'No messages yet'**
  String get msgEmpty;

  /// No description provided for @msgEmptyBody.
  ///
  /// In en, this message translates to:
  /// **'Send a message and the clinic team will reply here.'**
  String get msgEmptyBody;

  /// No description provided for @msgEmptyClinician.
  ///
  /// In en, this message translates to:
  /// **'Send a message to start the conversation.'**
  String get msgEmptyClinician;

  /// No description provided for @careMessageClinic.
  ///
  /// In en, this message translates to:
  /// **'Message the clinic'**
  String get careMessageClinic;

  /// No description provided for @careMessageClinicDesc.
  ///
  /// In en, this message translates to:
  /// **'Chat directly with the clinic team'**
  String get careMessageClinicDesc;

  /// No description provided for @callStart.
  ///
  /// In en, this message translates to:
  /// **'Call'**
  String get callStart;

  /// No description provided for @callVideo.
  ///
  /// In en, this message translates to:
  /// **'Video call'**
  String get callVideo;

  /// No description provided for @callVoice.
  ///
  /// In en, this message translates to:
  /// **'Voice call'**
  String get callVoice;

  /// No description provided for @callFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not start the call. Please try again.'**
  String get callFailed;

  /// No description provided for @apptToday.
  ///
  /// In en, this message translates to:
  /// **'Today'**
  String get apptToday;

  /// No description provided for @apptTomorrow.
  ///
  /// In en, this message translates to:
  /// **'Tomorrow'**
  String get apptTomorrow;

  /// No description provided for @apptWithDoctor.
  ///
  /// In en, this message translates to:
  /// **'with {doctor}'**
  String apptWithDoctor(String doctor);

  /// No description provided for @errorBadRequest.
  ///
  /// In en, this message translates to:
  /// **'That request could not be understood.'**
  String get errorBadRequest;

  /// No description provided for @errorValidation.
  ///
  /// In en, this message translates to:
  /// **'Please check the details you entered.'**
  String get errorValidation;

  /// No description provided for @errorUnauthorized.
  ///
  /// In en, this message translates to:
  /// **'Your session has expired. Please log in again.'**
  String get errorUnauthorized;

  /// No description provided for @errorAccessDeniedTitle.
  ///
  /// In en, this message translates to:
  /// **'You do not have access'**
  String get errorAccessDeniedTitle;

  /// No description provided for @errorNotFoundTitle.
  ///
  /// In en, this message translates to:
  /// **'Not found'**
  String get errorNotFoundTitle;

  /// No description provided for @errorOfflineTitle.
  ///
  /// In en, this message translates to:
  /// **'No connection'**
  String get errorOfflineTitle;

  /// No description provided for @errorRateLimitedTitle.
  ///
  /// In en, this message translates to:
  /// **'Too many requests'**
  String get errorRateLimitedTitle;

  /// No description provided for @errorSignedOutTitle.
  ///
  /// In en, this message translates to:
  /// **'Signed out'**
  String get errorSignedOutTitle;

  /// No description provided for @errorForbidden.
  ///
  /// In en, this message translates to:
  /// **'You don\'t have permission to do that.'**
  String get errorForbidden;

  /// No description provided for @errorNotFound.
  ///
  /// In en, this message translates to:
  /// **'We couldn\'t find what you\'re looking for.'**
  String get errorNotFound;

  /// No description provided for @errorConflict.
  ///
  /// In en, this message translates to:
  /// **'This conflicts with existing data.'**
  String get errorConflict;

  /// No description provided for @errorDuplicate.
  ///
  /// In en, this message translates to:
  /// **'This already exists.'**
  String get errorDuplicate;

  /// No description provided for @errorRateLimited.
  ///
  /// In en, this message translates to:
  /// **'Too many attempts. Please wait a moment and try again.'**
  String get errorRateLimited;

  /// No description provided for @errorInvalidId.
  ///
  /// In en, this message translates to:
  /// **'That reference is invalid.'**
  String get errorInvalidId;

  /// No description provided for @errorInternal.
  ///
  /// In en, this message translates to:
  /// **'Something went wrong on our end. Please try again.'**
  String get errorInternal;

  /// No description provided for @errorAiUnavailable.
  ///
  /// In en, this message translates to:
  /// **'The assistant is temporarily unavailable. Please try again shortly.'**
  String get errorAiUnavailable;

  /// Auth: authOtpSendButton
  ///
  /// In en, this message translates to:
  /// **'Send OTP'**
  String get authOtpSendButton;

  /// Auth: authOtpTitle
  ///
  /// In en, this message translates to:
  /// **'Verify your number'**
  String get authOtpTitle;

  /// Auth: authOtpSentTo
  ///
  /// In en, this message translates to:
  /// **'We sent a 6-digit code to {phone}'**
  String authOtpSentTo(String phone);

  /// Auth: authOtpLabel
  ///
  /// In en, this message translates to:
  /// **'Verification code'**
  String get authOtpLabel;

  /// Auth: authOtpVerifyButton
  ///
  /// In en, this message translates to:
  /// **'Verify'**
  String get authOtpVerifyButton;

  /// Auth: authOtpResend
  ///
  /// In en, this message translates to:
  /// **'Send it again'**
  String get authOtpResend;

  /// Auth: authOtpResendIn
  ///
  /// In en, this message translates to:
  /// **'You can ask for a new code in {seconds}s'**
  String authOtpResendIn(int seconds);

  /// Auth: authOtpChangeNumber
  ///
  /// In en, this message translates to:
  /// **'Use a different number'**
  String get authOtpChangeNumber;

  /// Auth: authOtpIncomplete
  ///
  /// In en, this message translates to:
  /// **'Enter all 6 digits'**
  String get authOtpIncomplete;

  /// Auth: authOtpSimulated
  ///
  /// In en, this message translates to:
  /// **'SMS is not set up on this server, so no message was sent. The code is in the server log.'**
  String get authOtpSimulated;

  /// Auth: authPhoneVerified
  ///
  /// In en, this message translates to:
  /// **'Verified'**
  String get authPhoneVerified;

  /// Auth: authVerifyPhoneButton
  ///
  /// In en, this message translates to:
  /// **'Verify'**
  String get authVerifyPhoneButton;

  /// Auth: authAlreadyRegistered
  ///
  /// In en, this message translates to:
  /// **'This phone number is already registered. Please log in instead.'**
  String get authAlreadyRegistered;

  /// Auth: authNotRegistered
  ///
  /// In en, this message translates to:
  /// **'No account found for this number. Please create one first.'**
  String get authNotRegistered;

  /// Auth: a number with an open practice application, which can neither sign in nor register yet
  ///
  /// In en, this message translates to:
  /// **'This number is on a practice application that MedPin is still reviewing. You can sign in with it once the practice is approved; until then it cannot be used to register.'**
  String get authApplicationPending;

  /// Auth: authInviteLabel
  ///
  /// In en, this message translates to:
  /// **'Have an invite code?'**
  String get authInviteLabel;

  /// Auth: authInviteHint
  ///
  /// In en, this message translates to:
  /// **'Enter invite code'**
  String get authInviteHint;

  /// Auth: authInviteHelper
  ///
  /// In en, this message translates to:
  /// **'Only for dieticians invited by the clinic. Patients can leave this empty.'**
  String get authInviteHelper;

  /// Auth: authInviteValidateButton
  ///
  /// In en, this message translates to:
  /// **'Validate'**
  String get authInviteValidateButton;

  /// Auth: authInviteVerified
  ///
  /// In en, this message translates to:
  /// **'Dietician invitation verified'**
  String get authInviteVerified;

  /// Auth: authInviteInvalid
  ///
  /// In en, this message translates to:
  /// **'That invite code is not valid or has expired.'**
  String get authInviteInvalid;

  /// Auth: authInviteRemove
  ///
  /// In en, this message translates to:
  /// **'Remove code'**
  String get authInviteRemove;

  /// Auth: authRegisterTitleDietician
  ///
  /// In en, this message translates to:
  /// **'Dietician registration'**
  String get authRegisterTitleDietician;

  /// Auth: authRegisterTitlePatient
  ///
  /// In en, this message translates to:
  /// **'Patient registration'**
  String get authRegisterTitlePatient;

  /// Auth: authVerifyFirst
  ///
  /// In en, this message translates to:
  /// **'Verify your phone number to continue'**
  String get authVerifyFirst;

  /// Auth: authDoctorPasswordLink
  ///
  /// In en, this message translates to:
  /// **'Doctor or clinic staff? Sign in with a password'**
  String get authDoctorPasswordLink;

  /// Auth: authDoctorPasswordTitle
  ///
  /// In en, this message translates to:
  /// **'Clinic sign-in'**
  String get authDoctorPasswordTitle;

  /// Auth: authDoctorPasswordSubtitle
  ///
  /// In en, this message translates to:
  /// **'For the doctor and clinic staff. You can also sign in with a code sent by SMS.'**
  String get authDoctorPasswordSubtitle;

  /// Auth: authUseOtpInstead
  ///
  /// In en, this message translates to:
  /// **'Sign in with an SMS code instead'**
  String get authUseOtpInstead;

  /// No description provided for @deskFrontDesk.
  ///
  /// In en, this message translates to:
  /// **'Front desk'**
  String get deskFrontDesk;

  /// No description provided for @deskToday.
  ///
  /// In en, this message translates to:
  /// **'Today'**
  String get deskToday;

  /// No description provided for @deskRegister.
  ///
  /// In en, this message translates to:
  /// **'Register'**
  String get deskRegister;

  /// No description provided for @deskBooked.
  ///
  /// In en, this message translates to:
  /// **'Booked'**
  String get deskBooked;

  /// No description provided for @deskWaiting.
  ///
  /// In en, this message translates to:
  /// **'Waiting'**
  String get deskWaiting;

  /// No description provided for @deskUnread.
  ///
  /// In en, this message translates to:
  /// **'Unread'**
  String get deskUnread;

  /// No description provided for @deskNoAppointments.
  ///
  /// In en, this message translates to:
  /// **'No appointments'**
  String get deskNoAppointments;

  /// No description provided for @deskQuietDay.
  ///
  /// In en, this message translates to:
  /// **'A quiet day. Walk-ins can be registered from the button below.'**
  String get deskQuietDay;

  /// No description provided for @deskWaitingForTimeCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 person is waiting for a time.} other{{count} people are waiting for a time.}}'**
  String deskWaitingForTimeCount(int count);

  /// No description provided for @deskAppointmentCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 appointment} other{{count} appointments}}'**
  String deskAppointmentCount(int count);

  /// No description provided for @deskNextAt.
  ///
  /// In en, this message translates to:
  /// **'Next: {name} at {time}'**
  String deskNextAt(String name, String time);

  /// No description provided for @deskAllPassed.
  ///
  /// In en, this message translates to:
  /// **'Everyone booked for today has been and gone.'**
  String get deskAllPassed;

  /// No description provided for @deskNothingBooked.
  ///
  /// In en, this message translates to:
  /// **'Nothing booked today'**
  String get deskNothingBooked;

  /// No description provided for @deskNothingBookedBody.
  ///
  /// In en, this message translates to:
  /// **'Appointments confirmed for today appear here.'**
  String get deskNothingBookedBody;

  /// No description provided for @deskWaitingForTime.
  ///
  /// In en, this message translates to:
  /// **'Waiting for a time'**
  String get deskWaitingForTime;

  /// No description provided for @deskNeedsAttention.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{Needs attention now} other{{count} need attention now}}'**
  String deskNeedsAttention(int count);

  /// No description provided for @deskGiveTime.
  ///
  /// In en, this message translates to:
  /// **'Give a time'**
  String get deskGiveTime;

  /// No description provided for @deskDecline.
  ///
  /// In en, this message translates to:
  /// **'Decline'**
  String get deskDecline;

  /// No description provided for @deskDeclineTitle.
  ///
  /// In en, this message translates to:
  /// **'Decline this request?'**
  String get deskDeclineTitle;

  /// No description provided for @deskDeclineBody.
  ///
  /// In en, this message translates to:
  /// **'The patient will be told the clinic could not offer a time. Message them first if there is a reason they should know.'**
  String get deskDeclineBody;

  /// No description provided for @deskKeepIt.
  ///
  /// In en, this message translates to:
  /// **'Keep it'**
  String get deskKeepIt;

  /// No description provided for @deskPatientTold.
  ///
  /// In en, this message translates to:
  /// **'The patient has been told.'**
  String get deskPatientTold;

  /// No description provided for @deskPatientFallback.
  ///
  /// In en, this message translates to:
  /// **'Patient'**
  String get deskPatientFallback;

  /// No description provided for @deskCheckIn.
  ///
  /// In en, this message translates to:
  /// **'Check in'**
  String get deskCheckIn;

  /// No description provided for @deskCheckedIn.
  ///
  /// In en, this message translates to:
  /// **'Checked in'**
  String get deskCheckedIn;

  /// No description provided for @deskWithDoctor.
  ///
  /// In en, this message translates to:
  /// **'With the doctor'**
  String get deskWithDoctor;

  /// No description provided for @deskVisitDone.
  ///
  /// In en, this message translates to:
  /// **'Done'**
  String get deskVisitDone;

  /// No description provided for @deskNoShow.
  ///
  /// In en, this message translates to:
  /// **'No show'**
  String get deskNoShow;

  /// No description provided for @deskConfirmed.
  ///
  /// In en, this message translates to:
  /// **'Confirmed'**
  String get deskConfirmed;

  /// No description provided for @deskConfirmedFor.
  ///
  /// In en, this message translates to:
  /// **'Confirmed for {when}'**
  String deskConfirmedFor(String when);

  /// No description provided for @deskChange.
  ///
  /// In en, this message translates to:
  /// **'Change'**
  String get deskChange;

  /// No description provided for @deskAskedFor.
  ///
  /// In en, this message translates to:
  /// **'for {when}'**
  String deskAskedFor(String when);

  /// No description provided for @deskAskedAgoMinutes.
  ///
  /// In en, this message translates to:
  /// **'asked {n}m ago'**
  String deskAskedAgoMinutes(int n);

  /// No description provided for @deskAskedAgoHours.
  ///
  /// In en, this message translates to:
  /// **'asked {n}h ago'**
  String deskAskedAgoHours(int n);

  /// No description provided for @deskAskedAgoDays.
  ///
  /// In en, this message translates to:
  /// **'asked {n}d ago'**
  String deskAskedAgoDays(int n);

  /// No description provided for @deskCallPatient.
  ///
  /// In en, this message translates to:
  /// **'Call {phone}'**
  String deskCallPatient(String phone);

  /// No description provided for @deskNoActiveClinic.
  ///
  /// In en, this message translates to:
  /// **'No active clinic to book into. Add one in Profile.'**
  String get deskNoActiveClinic;

  /// No description provided for @deskNoFreeTimes.
  ///
  /// In en, this message translates to:
  /// **'Nothing free on this day'**
  String get deskNoFreeTimes;

  /// No description provided for @deskTryAnotherDay.
  ///
  /// In en, this message translates to:
  /// **'Try another day, or another clinic.'**
  String get deskTryAnotherDay;

  /// No description provided for @deskOnlyAvailable.
  ///
  /// In en, this message translates to:
  /// **'Only times the doctor is actually available are offered.'**
  String get deskOnlyAvailable;

  /// No description provided for @deskCouldNotLoadTimes.
  ///
  /// In en, this message translates to:
  /// **'Could not load the times for this day.'**
  String get deskCouldNotLoadTimes;

  /// No description provided for @deskClinicStaff.
  ///
  /// In en, this message translates to:
  /// **'Clinic staff'**
  String get deskClinicStaff;

  /// No description provided for @deskTheClinic.
  ///
  /// In en, this message translates to:
  /// **'The clinic'**
  String get deskTheClinic;

  /// No description provided for @deskClinicDetails.
  ///
  /// In en, this message translates to:
  /// **'Clinic details'**
  String get deskClinicDetails;

  /// No description provided for @deskClinicDetailsSub.
  ///
  /// In en, this message translates to:
  /// **'Name, address, phones, logo and opening hours'**
  String get deskClinicDetailsSub;

  /// No description provided for @deskOpeningHours.
  ///
  /// In en, this message translates to:
  /// **'Opening hours'**
  String get deskOpeningHours;

  /// No description provided for @deskThisAccount.
  ///
  /// In en, this message translates to:
  /// **'This account'**
  String get deskThisAccount;

  /// No description provided for @deskYourDetails.
  ///
  /// In en, this message translates to:
  /// **'Your details'**
  String get deskYourDetails;

  /// No description provided for @deskYourDetailsSub.
  ///
  /// In en, this message translates to:
  /// **'Name, photo and contact'**
  String get deskYourDetailsSub;

  /// No description provided for @deskSignOut.
  ///
  /// In en, this message translates to:
  /// **'Sign out'**
  String get deskSignOut;

  /// No description provided for @deskSignOutTitle.
  ///
  /// In en, this message translates to:
  /// **'Sign out?'**
  String get deskSignOutTitle;

  /// No description provided for @deskSignOutBody.
  ///
  /// In en, this message translates to:
  /// **'You will need the clinic number and the password, or a code sent by SMS, to sign in again.'**
  String get deskSignOutBody;

  /// No description provided for @deskStay.
  ///
  /// In en, this message translates to:
  /// **'Stay'**
  String get deskStay;

  /// No description provided for @deskPhotoUpdated.
  ///
  /// In en, this message translates to:
  /// **'Photo updated'**
  String get deskPhotoUpdated;

  /// No description provided for @deskTakePhoto.
  ///
  /// In en, this message translates to:
  /// **'Take a photo'**
  String get deskTakePhoto;

  /// No description provided for @deskChooseFromGallery.
  ///
  /// In en, this message translates to:
  /// **'Choose from gallery'**
  String get deskChooseFromGallery;

  /// No description provided for @deskAbout.
  ///
  /// In en, this message translates to:
  /// **'About'**
  String get deskAbout;

  /// No description provided for @deskNoDeviceLock.
  ///
  /// In en, this message translates to:
  /// **'This phone has no fingerprint or PIN set up.'**
  String get deskNoDeviceLock;

  /// No description provided for @deskAppLockSub.
  ///
  /// In en, this message translates to:
  /// **'Ask for the phone’s fingerprint or PIN each time it opens'**
  String get deskAppLockSub;

  /// No description provided for @deskCouldNotUpdatePhoto.
  ///
  /// In en, this message translates to:
  /// **'Could not update the photo.'**
  String get deskCouldNotUpdatePhoto;

  /// No description provided for @deskOpen.
  ///
  /// In en, this message translates to:
  /// **'Open'**
  String get deskOpen;

  /// No description provided for @deskClosed.
  ///
  /// In en, this message translates to:
  /// **'Closed'**
  String get deskClosed;

  /// No description provided for @deskClosedToday.
  ///
  /// In en, this message translates to:
  /// **'Closed today'**
  String get deskClosedToday;

  /// No description provided for @deskRefresh.
  ///
  /// In en, this message translates to:
  /// **'Refresh'**
  String get deskRefresh;

  /// No description provided for @deskUrgentChip.
  ///
  /// In en, this message translates to:
  /// **'URGENT'**
  String get deskUrgentChip;

  /// No description provided for @deskReviewNow.
  ///
  /// In en, this message translates to:
  /// **'Review now'**
  String get deskReviewNow;

  /// No description provided for @deskTodaysQueue.
  ///
  /// In en, this message translates to:
  /// **'Today\'s queue'**
  String get deskTodaysQueue;

  /// No description provided for @deskManageQueue.
  ///
  /// In en, this message translates to:
  /// **'Manage queue'**
  String get deskManageQueue;

  /// No description provided for @deskScheduled.
  ///
  /// In en, this message translates to:
  /// **'Scheduled'**
  String get deskScheduled;

  /// No description provided for @deskInProgress.
  ///
  /// In en, this message translates to:
  /// **'In progress'**
  String get deskInProgress;

  /// No description provided for @deskForScheduling.
  ///
  /// In en, this message translates to:
  /// **'For scheduling'**
  String get deskForScheduling;

  /// No description provided for @deskNowLabel.
  ///
  /// In en, this message translates to:
  /// **'Now'**
  String get deskNowLabel;

  /// No description provided for @deskTodaysAppointments.
  ///
  /// In en, this message translates to:
  /// **'Today\'s appointments'**
  String get deskTodaysAppointments;

  /// No description provided for @deskViewCalendar.
  ///
  /// In en, this message translates to:
  /// **'View calendar'**
  String get deskViewCalendar;

  /// No description provided for @deskNoAppointmentsScheduled.
  ///
  /// In en, this message translates to:
  /// **'No appointments scheduled'**
  String get deskNoAppointmentsScheduled;

  /// No description provided for @deskAddWalkIn.
  ///
  /// In en, this message translates to:
  /// **'Add walk-in'**
  String get deskAddWalkIn;

  /// No description provided for @deskQuickActions.
  ///
  /// In en, this message translates to:
  /// **'Quick actions'**
  String get deskQuickActions;

  /// No description provided for @deskRegisterPatient.
  ///
  /// In en, this message translates to:
  /// **'Register patient'**
  String get deskRegisterPatient;

  /// No description provided for @deskAddNewPatient.
  ///
  /// In en, this message translates to:
  /// **'Add new patient'**
  String get deskAddNewPatient;

  /// No description provided for @deskNewAppointment.
  ///
  /// In en, this message translates to:
  /// **'New appointment'**
  String get deskNewAppointment;

  /// No description provided for @deskBookAppointment.
  ///
  /// In en, this message translates to:
  /// **'Book appointment'**
  String get deskBookAppointment;

  /// No description provided for @deskCheckInPatient.
  ///
  /// In en, this message translates to:
  /// **'Check-in patient'**
  String get deskCheckInPatient;

  /// No description provided for @deskWalkInCheckIn.
  ///
  /// In en, this message translates to:
  /// **'Walk-in check-in'**
  String get deskWalkInCheckIn;

  /// No description provided for @deskMessagesLabel.
  ///
  /// In en, this message translates to:
  /// **'Messages'**
  String get deskMessagesLabel;

  /// No description provided for @deskClinicSummary.
  ///
  /// In en, this message translates to:
  /// **'Clinic summary'**
  String get deskClinicSummary;

  /// No description provided for @deskCompleted.
  ///
  /// In en, this message translates to:
  /// **'Completed'**
  String get deskCompleted;

  /// No description provided for @deskCancelled.
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get deskCancelled;

  /// No description provided for @deskNoShows.
  ///
  /// In en, this message translates to:
  /// **'No shows'**
  String get deskNoShows;

  /// No description provided for @deskTotalVisitors.
  ///
  /// In en, this message translates to:
  /// **'Total visitors'**
  String get deskTotalVisitors;

  /// No description provided for @deskOfferTime.
  ///
  /// In en, this message translates to:
  /// **'Schedule'**
  String get deskOfferTime;

  /// No description provided for @deskWaitingForScheduling.
  ///
  /// In en, this message translates to:
  /// **'Waiting for scheduling'**
  String get deskWaitingForScheduling;

  /// No description provided for @deskCatUrgent.
  ///
  /// In en, this message translates to:
  /// **'Urgent'**
  String get deskCatUrgent;

  /// No description provided for @deskCatAppointments.
  ///
  /// In en, this message translates to:
  /// **'Appointments'**
  String get deskCatAppointments;

  /// No description provided for @deskCatMessages.
  ///
  /// In en, this message translates to:
  /// **'Messages'**
  String get deskCatMessages;

  /// No description provided for @deskUrgentSymptom.
  ///
  /// In en, this message translates to:
  /// **'Urgent patient-reported symptom'**
  String get deskUrgentSymptom;

  /// No description provided for @deskNothingInProgress.
  ///
  /// In en, this message translates to:
  /// **'No appointment in progress'**
  String get deskNothingInProgress;

  /// No description provided for @deskClosesAt.
  ///
  /// In en, this message translates to:
  /// **'Closes {time}'**
  String deskClosesAt(String time);

  /// No description provided for @deskOpensAt.
  ///
  /// In en, this message translates to:
  /// **'Opens {time}'**
  String deskOpensAt(String time);

  /// No description provided for @deskUnreadCount.
  ///
  /// In en, this message translates to:
  /// **'{count} unread'**
  String deskUnreadCount(int count);

  /// No description provided for @deskReportedAgoMinutes.
  ///
  /// In en, this message translates to:
  /// **'Reported {count} min ago'**
  String deskReportedAgoMinutes(int count);

  /// No description provided for @deskReportedAgoHours.
  ///
  /// In en, this message translates to:
  /// **'Reported {count} h ago'**
  String deskReportedAgoHours(int count);

  /// No description provided for @deskReportedAgoDays.
  ///
  /// In en, this message translates to:
  /// **'Reported {count} d ago'**
  String deskReportedAgoDays(int count);

  /// No description provided for @deskWaitingCount.
  ///
  /// In en, this message translates to:
  /// **'{count} waiting for scheduling'**
  String deskWaitingCount(int count);

  /// No description provided for @rangeThisWeek.
  ///
  /// In en, this message translates to:
  /// **'This week'**
  String get rangeThisWeek;

  /// No description provided for @deskChoosePatient.
  ///
  /// In en, this message translates to:
  /// **'Choose a patient'**
  String get deskChoosePatient;

  /// No description provided for @deskSearchPatients.
  ///
  /// In en, this message translates to:
  /// **'Search by name or phone'**
  String get deskSearchPatients;

  /// No description provided for @deskNoPatientsFound.
  ///
  /// In en, this message translates to:
  /// **'No patients found'**
  String get deskNoPatientsFound;

  /// No description provided for @deskNobodyToCheckIn.
  ///
  /// In en, this message translates to:
  /// **'Nobody is waiting to be checked in.'**
  String get deskNobodyToCheckIn;

  /// No description provided for @nutritionLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not load the conversation'**
  String get nutritionLoadFailed;

  /// No description provided for @nutritionNoMessages.
  ///
  /// In en, this message translates to:
  /// **'No messages yet'**
  String get nutritionNoMessages;

  /// No description provided for @deskAlreadyBookedTitle.
  ///
  /// In en, this message translates to:
  /// **'Already booked that day'**
  String get deskAlreadyBookedTitle;

  /// No description provided for @deskAlreadyBookedBody.
  ///
  /// In en, this message translates to:
  /// **'This patient already has an appointment on that day. Book another one anyway?'**
  String get deskAlreadyBookedBody;

  /// No description provided for @deskBookAnyway.
  ///
  /// In en, this message translates to:
  /// **'Book anyway'**
  String get deskBookAnyway;

  /// No description provided for @deskAlreadyBookedAt.
  ///
  /// In en, this message translates to:
  /// **'This patient already has {time} on that day. Book another one anyway?'**
  String deskAlreadyBookedAt(String time);

  /// No description provided for @apptYourAppointments.
  ///
  /// In en, this message translates to:
  /// **'Your appointments'**
  String get apptYourAppointments;

  /// No description provided for @apptViewAll.
  ///
  /// In en, this message translates to:
  /// **'View all'**
  String get apptViewAll;

  /// No description provided for @apptNotAvailable.
  ///
  /// In en, this message translates to:
  /// **'Not available'**
  String get apptNotAvailable;

  /// No description provided for @apptNotAvailableBody.
  ///
  /// In en, this message translates to:
  /// **'The clinic could not give you this day. Please ask for another.'**
  String get apptNotAvailableBody;

  /// No description provided for @apptWaitingReply.
  ///
  /// In en, this message translates to:
  /// **'Waiting for the clinic'**
  String get apptWaitingReply;

  /// No description provided for @apptYouAskedFor.
  ///
  /// In en, this message translates to:
  /// **'You asked for {day}'**
  String apptYouAskedFor(String day);

  /// No description provided for @apptNothingYet.
  ///
  /// In en, this message translates to:
  /// **'No appointments yet'**
  String get apptNothingYet;

  /// No description provided for @deskFreedUp.
  ///
  /// In en, this message translates to:
  /// **'Freed up'**
  String get deskFreedUp;

  /// No description provided for @deskTodayLabel.
  ///
  /// In en, this message translates to:
  /// **'Today'**
  String get deskTodayLabel;

  /// No description provided for @deskRequests.
  ///
  /// In en, this message translates to:
  /// **'Requests'**
  String get deskRequests;

  /// No description provided for @deskDeclined.
  ///
  /// In en, this message translates to:
  /// **'Declined'**
  String get deskDeclined;

  /// No description provided for @deskConfirmedCount.
  ///
  /// In en, this message translates to:
  /// **'Confirmed'**
  String get deskConfirmedCount;

  /// No description provided for @deskAppointmentsLabel.
  ///
  /// In en, this message translates to:
  /// **'Appointments'**
  String get deskAppointmentsLabel;

  /// No description provided for @deskViewDiary.
  ///
  /// In en, this message translates to:
  /// **'View the diary'**
  String get deskViewDiary;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['bn', 'en', 'hi'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'bn':
      return AppLocalizationsBn();
    case 'en':
      return AppLocalizationsEn();
    case 'hi':
      return AppLocalizationsHi();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
