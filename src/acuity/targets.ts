// Every on-page element the agent ever looks for, in one place.
//
// Each has a cache key (where the answer is remembered) and a plain-English
// intent (what the AI is told to look for if the remembered answer breaks).
// The tasks (book/cancel/edit) use these, and the daily healthcheck checks
// that every one of them can still be found.

import type { Target } from "../heal/resolve";

export const TARGETS = {
  // Appointment page
  editLink: { key: "appointment.edit_link", intent: "The 'Edit' link that switches this appointment into edit mode" },
  cancelLink: { key: "appointment.cancel_link", intent: "The 'Cancel' link that starts cancelling this appointment (NOT 'Cancel Editing')" },

  // "Are you sure?" cancel pop-up
  cancelEmailBox: { key: "cancel.send_email_checkbox", intent: "In the cancel confirmation pop-up: the 'Send email to client' checkbox" },
  cancelNoteBox: { key: "cancel.note_box", intent: "In the cancel confirmation pop-up: the text box for an optional note to the client" },
  cancelConfirm: { key: "cancel.confirm_button", intent: "In the cancel confirmation pop-up: the button that finally cancels the appointment" },

  // Edit mode
  editFirstName: { key: "edit.first_name", intent: "In the appointment edit form: the client's First Name text box" },
  editLastName: { key: "edit.last_name", intent: "In the appointment edit form: the client's Last Name text box" },
  editPhone: { key: "edit.phone", intent: "In the appointment edit form: the client's Phone text box" },
  editEmail: { key: "edit.email", intent: "In the appointment edit form: the client's Email text box" },
  editNotes: { key: "edit.notes", intent: "In the appointment edit form: the private notes about this appointment" },
  editPrice: { key: "edit.price", intent: "In the appointment edit form: the Total Price text box" },
  editPaid: { key: "edit.paid", intent: "In the appointment edit form: the checkbox saying whether the total price has been paid" },
  editSave: { key: "edit.save_button", intent: "In the appointment edit form: the Save button" },

  // Reschedule page
  rescheduleConfirm: { key: "reschedule.confirm_button", intent: "The button that confirms rescheduling the appointment to the chosen time" },

  // New appointment form
  bookFirstName: { key: "book.first_name", intent: "In the new appointment form: the client's First Name text box" },
  bookLastName: { key: "book.last_name", intent: "In the new appointment form: the client's Last Name text box" },
  bookEmail: { key: "book.email", intent: "In the new appointment form: the client's Email text box" },
  bookPhone: { key: "book.phone", intent: "In the new appointment form: the client's Phone text box" },
  bookConfirm: { key: "book.confirm_button", intent: "In the new appointment form: the 'Schedule Appointment' button that books it" },
} satisfies Record<string, Target>;
