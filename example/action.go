package main

//go:generate ./scripts/copy-wasm-exec.bash

import "github.com/bitwizeshift/go-github-actions/pkg/core"

func main() {
	core.Group("Group 1", func() {
		core.Debugf("Debug")
		core.Noticef("Notice")
		core.Warningf("Warning")
		core.Errorf("Error")
		core.Printf("Normal message")

		core.Group("Group 2", func() {
			core.Debugf("Debug")
			core.Noticef("Notice")
			core.Warningf("Warning")
			core.Errorf("Error")
			core.Printf("Normal message")
		})
	})
}
