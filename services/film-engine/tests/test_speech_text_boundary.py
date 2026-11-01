"""Offline regression for pinned Habibi Arabic reference/target boundary."""

from pathlib import Path

import sys, unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'engine'))

from speech.backends import habibi_target_text

class BoundaryTests(unittest.TestCase):

    def test_arabic_reference_does_not_join_first_generated_word(self):

        ref='الانتخابات المحلية';text='نعيش وكأن الوقت لا ينتهي.'

        value=habibi_target_text(ref,text)

        self.assertEqual(ref+value,'الانتخابات المحلية نعيش وكأن الوقت لا ينتهي.')

        self.assertEqual(value.strip(),text)

    def test_existing_boundary_and_ascii_reference_are_not_duplicated(self):

        for ref,text in [('مرجع ','نص'),('مرجع',' نص'),('مرجع.','نص')]:

            self.assertEqual(habibi_target_text(ref,text),text)

if __name__=='__main__':unittest.main()
