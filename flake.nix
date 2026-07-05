{
  description = "NestJS Server Development Environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_22      
            pnpm            
            
            prettier
            eslint
            
            # LSP
            vtsls                                  # Modern, highly optimized TS LSP (preferred by LazyVim)
            typescript-language-server # Fallback classic TS LSP
            vscode-langservers-extracted # Provides the underlying 'eslint-language-server'
            
            # Native Build Tools (Fixes common 'node-gyp' compilation failures on NixOS)
            python3
            gcc
            gnumake

            prisma-engines
          ];

          shellHook = ''
            echo "========================================================"
            echo " 🟩 NestJS Development Environment Active"
            echo " Node.js: $(node --version)"
            echo " PNPM:    $(pnpm --version 2>/dev/null || echo 'N/A')"
            echo "========================================================"
            
            # Automatically inject local project binaries into your shell path.
            # This allows you to type 'nest start' instead of './node_modules/.bin/nest start'
            export PATH="$PWD/node_modules/.bin:$PATH"
          '';
        };
      }
    );
}
