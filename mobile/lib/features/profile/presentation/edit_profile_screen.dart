import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/utils/auth_validators.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../../auth/presentation/auth_controller.dart';

/// Edits the fields `PATCH /auth/me` accepts.
///
/// Phone is shown but locked: it is the login identifier, and letting a patient
/// change it here would let them lock themselves out of an account holding
/// their clinical history.
class EditProfileScreen extends ConsumerStatefulWidget {
  const EditProfileScreen({super.key});

  @override
  ConsumerState<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends ConsumerState<EditProfileScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _nameController;
  late final TextEditingController _emailController;
  late final TextEditingController _addressController;

  DateTime? _dateOfBirth;
  String? _gender;
  bool _isSaving = false;
  AutovalidateMode _autovalidateMode = AutovalidateMode.disabled;

  @override
  void initState() {
    super.initState();
    final user = ref.read(authControllerProvider).user;
    _nameController = TextEditingController(text: user?.name ?? '');
    _emailController = TextEditingController(text: user?.email ?? '');
    _addressController = TextEditingController(text: user?.address ?? '');
    _dateOfBirth = user?.dateOfBirth;
    _gender = user?.gender;
  }

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _addressController.dispose();
    super.dispose();
  }

  Future<void> _pickDateOfBirth() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _dateOfBirth ?? DateTime(now.year - 45, now.month, now.day),
      firstDate: DateTime(now.year - AuthValidators.maxAgeYears),
      lastDate: now,
    );
    if (picked != null) setState(() => _dateOfBirth = picked);
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) {
      setState(() => _autovalidateMode = AutovalidateMode.onUserInteraction);
      return;
    }

    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    setState(() => _isSaving = true);

    final email = _emailController.text.trim();
    try {
      final user = await ref
          .read(authRepositoryProvider)
          .updateMe(
            name: _nameController.text.trim(),
            email: email.isEmpty ? null : email,
            dateOfBirth:
                _dateOfBirth == null
                    ? null
                    : '${_dateOfBirth!.year.toString().padLeft(4, '0')}-'
                        '${_dateOfBirth!.month.toString().padLeft(2, '0')}-'
                        '${_dateOfBirth!.day.toString().padLeft(2, '0')}',
            gender: _gender,
            // Always sent, including empty. Omitted when blank, the field
            // could be set but never cleared: a patient who moved could add a
            // new address and never remove the old one.
            address: _addressController.text.trim(),
          );
      ref.read(authControllerProvider.notifier).replaceUser(user);
      messenger.showSnackBar(SnackBar(content: Text(l10n.profileSaved)));
      navigator.pop();
    } on ApiException {
      if (!mounted) return;
      setState(() => _isSaving = false);
      messenger.showSnackBar(
        SnackBar(content: Text(l10n.commonSomethingWentWrong)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final accent = isDark ? AppColors.primaryDark : AppColors.primary;
    final user = ref.watch(authControllerProvider).user;
    final name = user?.name ?? '';
    // Only a patient carries clinical intake on their account. Defaulting to
    // patient keeps the screen unchanged for the role it was written for if
    // the user has not loaded yet.
    final isPatient = (user?.role ?? 'patient') == 'patient';

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.profileEditProfile),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: AppSpacing.md),
            child: TextButton(
              onPressed: _isSaving ? null : _save,
              style: TextButton.styleFrom(
                backgroundColor: accent,
                foregroundColor: Colors.white,
                disabledBackgroundColor: accent.withValues(alpha: 0.4),
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.lg,
                  vertical: 8,
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(20),
                ),
              ),
              child:
                  _isSaving
                      ? const SizedBox(
                        width: 16,
                        height: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.2,
                          color: Colors.white,
                        ),
                      )
                      : Text(
                        l10n.profileSave,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
            ),
          ),
        ],
      ),
      body: Form(
        key: _formKey,
        autovalidateMode: _autovalidateMode,
        child: ListView(
          padding: const EdgeInsets.all(AppSpacing.md),
          children: [
            const SizedBox(height: AppSpacing.sm),
            // UserAvatar, not a hand-rolled initial disc: this screen drew its
            // own and so never showed the photo the user had set — on either
            // panel, since both share it. UserAvatar already handles the bearer
            // token these owner-protected images need.
            Center(
              child: UserAvatar(
                name: name,
                avatarUrl: user?.avatarUrl,
                accent: accent,
                size: 96,
              ),
            ),
            const SizedBox(height: AppSpacing.xl),
            Container(
              decoration: BoxDecoration(
                color: scheme.surface,
                borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
                border: Border.all(color: scheme.outlineVariant),
              ),
              clipBehavior: Clip.antiAlias,
              child: Column(
                children: [
                  _Field(
                    label: l10n.authNameLabel,
                    child: TextFormField(
                      controller: _nameController,
                      textCapitalization: TextCapitalization.words,
                      style: const TextStyle(fontSize: 16),
                      decoration: const InputDecoration(
                        border: InputBorder.none,
                        enabledBorder: InputBorder.none,
                        focusedBorder: InputBorder.none,
                        errorBorder: InputBorder.none,
                        focusedErrorBorder: InputBorder.none,
                        filled: false,
                        isDense: true,
                        contentPadding: EdgeInsets.zero,
                      ),
                      validator: (v) {
                        if (v == null || v.trim().isEmpty)
                          return l10n.commonRequiredField;
                        if (v.trim().length < AuthValidators.minNameLength) {
                          return l10n.authNameTooShort;
                        }
                        if (v.trim().length > AuthValidators.maxNameLength) {
                          return l10n.authNameTooLong;
                        }
                        return null;
                      },
                    ),
                  ),
                  _Divider(scheme: scheme),
                  // Locked: this is the login identifier.
                  _Field(
                    label: l10n.authPhoneLabel,
                    trailing: Icon(
                      Icons.lock_outline_rounded,
                      size: 18,
                      color: scheme.outline,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          user?.phone ?? '',
                          style: TextStyle(
                            fontSize: 16,
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                        const SizedBox(height: 3),
                        // Here, under the field, not at the foot of the form.
                        // A patient tapping this expects to edit it, and the
                        // answer has to be where the question is asked — a note
                        // three fields further down is read after the confusion,
                        // which is too late to prevent it.
                        Text(
                          l10n.profilePhoneLocked,
                          style: TextStyle(
                            fontSize: 12.5,
                            height: 1.35,
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ),
                  _Divider(scheme: scheme),
                  _Field(
                    label: l10n.authEmailLabel,
                    child: TextFormField(
                      controller: _emailController,
                      keyboardType: TextInputType.emailAddress,
                      style: const TextStyle(fontSize: 16),
                      decoration: const InputDecoration(
                        border: InputBorder.none,
                        enabledBorder: InputBorder.none,
                        focusedBorder: InputBorder.none,
                        errorBorder: InputBorder.none,
                        focusedErrorBorder: InputBorder.none,
                        filled: false,
                        isDense: true,
                        contentPadding: EdgeInsets.zero,
                      ),
                      validator:
                          (v) =>
                              (v == null ||
                                      v.trim().isEmpty ||
                                      AuthValidators.isValidEmail(v))
                                  ? null
                                  : l10n.authInvalidEmail,
                    ),
                  ),
                  // Date of birth, sex and address, for a patient only.
                  //
                  // This screen is "Your details" on all four panels. Those
                  // three are clinical intake — they are on the record because
                  // a doctor reads them, and they mean nothing on a reception,
                  // dietician or doctor account. A desk asked for its own date
                  // of birth is a desk wondering which of the two people who
                  // share the shift it is meant to enter.
                  if (isPatient) ...[
                    _Divider(scheme: scheme),
                    InkWell(
                      onTap: _pickDateOfBirth,
                      child: _Field(
                        label: l10n.authDateOfBirthLabel,
                        trailing: Icon(
                          Icons.calendar_today_outlined,
                          size: 18,
                          color: accent,
                        ),
                        child: Text(
                          _dateOfBirth == null
                              ? '—'
                              : '${_dateOfBirth!.day.toString().padLeft(2, '0')}/'
                                  '${_dateOfBirth!.month.toString().padLeft(2, '0')}/'
                                  '${_dateOfBirth!.year}',
                          style: const TextStyle(fontSize: 16),
                        ),
                      ),
                    ),
                    _Divider(scheme: scheme),
                    _Field(
                      label: l10n.authGenderLabel,
                      child: DropdownButtonHideUnderline(
                        child: DropdownButton<String>(
                          value: _gender,
                          isExpanded: true,
                          isDense: true,
                          hint: Text(
                            '—',
                            style: TextStyle(color: scheme.onSurfaceVariant),
                          ),
                          items: [
                            DropdownMenuItem(
                              value: 'male',
                              child: Text(l10n.authGenderMale),
                            ),
                            DropdownMenuItem(
                              value: 'female',
                              child: Text(l10n.authGenderFemale),
                            ),
                            DropdownMenuItem(
                              value: 'other',
                              child: Text(l10n.authGenderOther),
                            ),
                          ],
                          onChanged: (v) => setState(() => _gender = v),
                        ),
                      ),
                    ),
                    _Divider(scheme: scheme),
                    _Field(
                      label: 'Address',
                      child: TextFormField(
                        controller: _addressController,
                        textCapitalization: TextCapitalization.sentences,
                        minLines: 1,
                        maxLines: 3,
                        style: const TextStyle(fontSize: 16),
                        decoration: const InputDecoration(
                          border: InputBorder.none,
                          enabledBorder: InputBorder.none,
                          focusedBorder: InputBorder.none,
                          errorBorder: InputBorder.none,
                          focusedErrorBorder: InputBorder.none,
                          filled: false,
                          isDense: true,
                          contentPadding: EdgeInsets.zero,
                          hintText: 'House, street, area, city, PIN',
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Field extends StatelessWidget {
  const _Field({required this.label, required this.child, this.trailing});

  final String label;
  final Widget child;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md,
        vertical: 12,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label.toUpperCase(),
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 0.6,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 4),
                child,
              ],
            ),
          ),
          if (trailing != null) ...[
            const SizedBox(width: AppSpacing.sm),
            trailing!,
          ],
        ],
      ),
    );
  }
}

class _Divider extends StatelessWidget {
  const _Divider({required this.scheme});

  final ColorScheme scheme;

  @override
  Widget build(BuildContext context) => Divider(
    height: 1,
    thickness: 1,
    color: scheme.outlineVariant.withValues(alpha: 0.6),
  );
}
