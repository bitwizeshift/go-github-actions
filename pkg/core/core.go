/*
Package core contains helper functions and types that operate symmetrically with
GitHub's @actions/core API.
*/
package core

import (
	"fmt"
	"os"
)

func StartGroup(name string) {
	fmt.Fprintln(os.Stdout, "::group::"+name)
}

func EndGroup() {
	fmt.Fprintln(os.Stdout, "::endgroup::")
}

func Group(name string, f func()) {
	StartGroup(name)
	f()
	EndGroup()
}

func Debugf(format string, args ...any) {
	fmt.Fprintf(os.Stdout, "::debug::"+format+"\n", args...)
}

func Errorf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "::error::"+format+"\n", args...)
}

func Warningf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "::warning::"+format+"\n", args...)
}

func Noticef(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "::notice::"+format+"\n", args...)
}

func Printf(format string, args ...any) {
	fmt.Fprintf(os.Stdout, format+"\n", args...)
}
