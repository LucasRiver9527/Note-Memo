using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text;

class Program
{
    static int Main(string[] args)
    {
        string real7za = @"D:\project\node_modules\7zip-bin\win\x64\7za.exe";

        bool isExtract = args.Length > 0 && args[0] == "x";
        var list = new List<string>();
        bool added = false;

        for (int i = 0; i < args.Length; i++)
        {
            string a = args[i];
            if (a == "-snld")
            {
                if (isExtract && !added) { list.Add("-snl-"); added = true; }
                continue;
            }
            list.Add(a);
        }

        if (isExtract && !added)
        {
            list.Add("-snl-");
        }

        var psi = new ProcessStartInfo(real7za);
        psi.Arguments = BuildArgs(list);
        psi.UseShellExecute = false;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;

        using (var p = Process.Start(psi))
        {
            string so = p.StandardOutput.ReadToEnd();
            string se = p.StandardError.ReadToEnd();
            p.WaitForExit();
            Console.Out.Write(so);
            Console.Error.Write(se);
            return p.ExitCode;
        }
    }

    static string BuildArgs(List<string> args)
    {
        var sb = new StringBuilder();
        foreach (var a in args)
        {
            if (sb.Length > 0) sb.Append(' ');
            if (a.IndexOf(' ') >= 0 || a.IndexOf('\t') >= 0 || a.IndexOf('"') >= 0)
            {
                sb.Append('"').Append(a.Replace("\"", "\\\"")).Append('"');
            }
            else
            {
                sb.Append(a);
            }
        }
        return sb.ToString();
    }
}
